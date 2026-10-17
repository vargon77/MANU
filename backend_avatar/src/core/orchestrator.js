// @ts-check
import { BargeInController } from './barge-in.js';
import { RingBuffer, FrameAssembler, int16ToFloat32, float32ToInt16, toAlignedInt16 } from '../utils/audio-buffer.js';
import { encodeOutputPayload, OUTPUT_FLAGS } from '../contract/output-payload.js';

/** @typedef {{
 * assembler: FrameAssembler,
 * preRoll: RingBuffer,
 * captured: Float32Array[],
 * capturedSamples: number,
 * queuedSamples: number,
 * bargeIn: BargeInController,
 * queue: Promise<void>
 * }} AudioState */

export class ConversationOrchestrator {
  /** @param {{ config: import('../config/environment.js').EnvironmentConfig, sessions: import('./session-manager.js').SessionManager, vad: import('../modules/vad/silero-vad.js').SileroVad, asr: import('../modules/asr/whisper-asr.js').WhisperAsr, llm: import('../modules/llm/gemma-client.js').GemmaClient, tts: import('../modules/tts/piper-tts.js').PiperTts, lipsync: import('../modules/lipsync/viseme-extractor.js').VisemeExtractor }} dependencies */
  constructor(dependencies) {
    this.dependencies = dependencies;
    /** @type {WeakMap<object, AudioState>} */
    this.audioStates = new WeakMap();
  }

  /** @param {{ sendJson: (value: object) => void, sendBinary: (value: Uint8Array) => void }} client */
  connect(client) {
    const session = this.dependencies.sessions.create(client);
    const { config } = this.dependencies;
    const state = {
      assembler: new FrameAssembler(512),
      preRoll: new RingBuffer(Math.max(1, Math.floor(config.audio.sampleRate * config.audio.preRollMs / 1000))),
      captured: [],
      capturedSamples: 0,
      queuedSamples: 0,
      bargeIn: new BargeInController(config.bargeIn),
      queue: Promise.resolve()
    };
    this.audioStates.set(session, state);
    client.sendJson({ type: 'ready', sessionId: session.id, sampleRate: config.audio.sampleRate, frameSamples: 512 });
    return session;
  }

  /** @param {object} session @param {Uint8Array} bytes */
  receiveAudio(session, bytes) {
    if (bytes.byteLength % 2 !== 0) throw new RangeError('El audio de entrada debe contener muestras PCM16 completas.');
    const state = this.audioStates.get(session);
    if (!state) throw new Error('Sesión de audio no inicializada.');
    const samples = int16ToFloat32(toAlignedInt16(bytes));
    const queuedLimit = Math.floor(this.dependencies.config.audio.sampleRate * this.dependencies.config.audio.maxQueuedMs / 1000);
    if (state.queuedSamples + samples.length > queuedLimit) {
      this.sendError(session, new RangeError('La cola de audio está saturada; reduce la frecuencia de envío.'));
      return Promise.resolve();
    }
    state.queuedSamples += samples.length;
    state.queue = state.queue
      .then(async () => {
        const frames = state.assembler.push(samples);
        for (const frame of frames) await this.processFrame(session, state, frame);
      })
      .catch((error) => {
        this.sendError(session, error);
        state.assembler.reset();
        state.captured = [];
        state.capturedSamples = 0;
      })
      .finally(() => { state.queuedSamples = Math.max(0, state.queuedSamples - samples.length); });
    return state.queue;
  }

  /** @param {object} session @param {AudioState} state @param {Float32Array} frame */
  async processFrame(session, state, frame) {
    const { config, vad, sessions } = this.dependencies;
    const target = /** @type {{ id: string, status: string, client: { sendJson: (value: object) => void } }} */ (session);
    const event = await vad.process(frame, Date.now(), target.id);
    if (state.bargeIn.update(event.probability, target.status === 'speaking')) {
      sessions.cancelTurn(session, 'barge-in');
      state.bargeIn.reset();
    }

    if (event.speechStarted) {
      state.captured = [state.preRoll.toFloat32Array()];
      state.capturedSamples = state.captured[0].length;
      target.client.sendJson({ type: 'speech_started', probability: event.probability });
    }
    if (event.speaking) {
      if (state.captured.length === 0) state.captured = [];
      state.captured.push(frame.slice());
      state.capturedSamples += frame.length;
      if (state.capturedSamples >= config.audio.sampleRate * config.audio.maxSeconds) {
        this.finishUtterance(session, state);
        vad.reset(target.id);
      }
    } else {
      state.preRoll.push(frame);
    }
    if (event.speechEnded) this.finishUtterance(session, state);
  }

  /** @param {object} session @param {AudioState} state */
  finishUtterance(session, state) {
    if (state.capturedSamples === 0) return;
    const samples = new Float32Array(state.capturedSamples);
    let offset = 0;
    for (const chunk of state.captured) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    state.captured = [];
    state.capturedSamples = 0;
    state.preRoll.clear();
    if (samples.length < this.dependencies.config.audio.sampleRate * 0.12) return;
    void this.respondToAudio(session, float32ToInt16(samples));
  }

  /** @param {object} session @param {Int16Array} pcm */
  async respondToAudio(session, pcm) {
    const { asr } = this.dependencies;
    const target = /** @type {{ client: { sendJson: (value: object) => void, sendBinary: (value: Uint8Array) => void }, status: string }} */ (session);
    target.status = 'processing';
    target.client.sendJson({ type: 'state', value: 'processing' });
    const controller = this.dependencies.sessions.beginTurn(session);
    try {
      const text = await asr.transcribe(pcm, { signal: controller.signal });
      if (text) await this.respondToText(session, text, controller);
      else {
        target.status = 'listening';
        target.client.sendJson({ type: 'state', value: 'listening' });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        target.status = 'listening';
        this.sendError(session, error);
      }
    }
  }

  /** @param {object} session @param {string} text @param {{ turnId: number, signal: AbortSignal }} [turn] */
  async respondToText(session, text, turn) {
    const { config, sessions, llm, tts, lipsync } = this.dependencies;
    const target = /** @type {{ client: { sendJson: (value: object) => void, sendBinary: (value: Uint8Array) => void }, status: string, history: Array<{ role: 'system' | 'user' | 'assistant', content: string }> }} */ (session);
    const normalized = text.trim();
    if (!normalized || normalized.length > config.limits.maxTextChars) throw new RangeError('Texto vacío o supera el límite configurado.');
    const currentTurn = turn ?? sessions.beginTurn(session);
    try {
      sessions.addMessage(session, 'user', normalized);
      target.client.sendJson({ type: 'transcript', text: normalized, turnId: currentTurn.turnId });
      target.status = 'thinking';
      target.client.sendJson({ type: 'state', value: 'thinking', turnId: currentTurn.turnId });
      let answer = '';
      for await (const part of llm.generate([
        { role: 'system', content: 'Eres un avatar conversacional útil, natural y conciso. Responde en el idioma del usuario.' },
        ...target.history
      ], { signal: currentTurn.signal })) {
        answer += part;
        if (answer.length > config.limits.maxTextChars) throw new RangeError('La respuesta del modelo superó el máximo de caracteres.');
        target.client.sendJson({ type: 'text_delta', text: part, turnId: currentTurn.turnId });
      }
      if (!answer.trim()) throw new Error('El modelo local devolvió una respuesta vacía.');
      sessions.addMessage(session, 'assistant', answer.trim());
      target.status = 'speaking';
      target.client.sendJson({ type: 'assistant_text', text: answer.trim(), turnId: currentTurn.turnId });
      target.client.sendJson({ type: 'state', value: 'speaking', turnId: currentTurn.turnId });
      const speech = await tts.synthesize(answer.trim(), { signal: currentTurn.signal });
      const visemesPromise = lipsync.extract(speech.pcm, speech.sampleRate, { signal: currentTurn.signal });
      const visemes = await visemesPromise.catch((error) => {
        target.client.sendJson({ type: 'warning', code: 'LIPSYNC_FAILED', message: error instanceof Error ? error.message : String(error) });
        return [];
      });
      if (currentTurn.signal.aborted) return;
      target.client.sendJson({ type: 'visemes', turnId: currentTurn.turnId, cues: visemes });
      const binaryClient = /** @type {{ sendBinary: (value: Uint8Array) => void }} */ (/** @type {unknown} */ (target.client));
      binaryClient.sendBinary(encodeOutputPayload({
        flags: OUTPUT_FLAGS.FINAL | (visemes.length ? OUTPUT_FLAGS.HAS_VISEMES : 0),
        turnId: currentTurn.turnId,
        sampleRate: speech.sampleRate,
        audio: int16ToLittleEndianBytes(speech.pcm)
      }));
      target.status = 'listening';
      target.client.sendJson({ type: 'state', value: 'listening', turnId: currentTurn.turnId });
    } catch (error) {
      if (!currentTurn.signal.aborted) {
        target.status = 'listening';
        this.sendError(session, error);
      }
    }
  }

  /** @param {object} session @param {string} text */
  receiveText(session, text) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('El texto del usuario no puede estar vacío.');
    if (text.length > this.dependencies.config.limits.maxTextChars) {
      this.sendError(session, new RangeError('El texto supera el máximo de caracteres configurado.'));
      return;
    }
    void this.respondToText(session, text);
  }

  /** @param {object} session @param {unknown} error */
  sendError(session, error) {
    const target = /** @type {{ client: { sendJson: (value: object) => void }, status: string }} */ (session);
    const message = error instanceof Error ? error.message : 'Error interno no identificado.';
    target.status = 'listening';
    target.client.sendJson({ type: 'error', message });
  }

  /** @param {object} session */
  disconnect(session) {
    const target = /** @type {{ id: string }} */ (session);
    this.dependencies.vad.reset(target.id);
    this.audioStates.delete(session);
    this.dependencies.sessions.dispose(session);
  }
}

/** @param {Int16Array} samples */
function int16ToLittleEndianBytes(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) view.setInt16(index * 2, samples[index], true);
  return bytes;
}