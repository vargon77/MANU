// @ts-check
import * as ort from 'onnxruntime-node';

export class SileroVad {
  /** @param {{ modelPath: string, threshold: number, silenceMs: number, minSpeechMs: number, sampleRate?: number }} options */
  constructor(options) {
    if (!options.modelPath) throw new Error('SileroVad requiere modelPath.');
    this.options = { ...options, sampleRate: options.sampleRate ?? 16000 };
    this.session = null;
    /** @type {Map<string, { state: Float32Array, speaking: boolean, speechStartAt: number | null, lastSpeechAt: number | null }>} */
    this.streams = new Map();
  }

  async initialize() {
    if (!this.session) this.session = await ort.InferenceSession.create(this.options.modelPath, { executionProviders: ['cpu'] });
    return this;
  }

  /** @param {Float32Array} frame @param {number} nowMs @param {string} streamId */
  async process(frame, nowMs = Date.now(), streamId = 'default') {
    if (!this.session) throw new Error('SileroVad no está inicializado.');
    if (!(frame instanceof Float32Array) || frame.length !== 512) throw new RangeError('Silero VAD requiere frames Float32 de 512 muestras a 16 kHz.');
    const inputs = this.session.inputNames;
    if (!inputs.includes('input') || !inputs.includes('state') || !inputs.includes('sr')) {
      throw new Error(`Modelo Silero incompatible. Entradas detectadas: ${inputs.join(', ')}.`);
    }
    const stream = this.streams.get(streamId) ?? {
      state: new Float32Array(2 * 1 * 128),
      speaking: false,
      speechStartAt: null,
      lastSpeechAt: null
    };
    this.streams.set(streamId, stream);
    const feeds = {
      input: new ort.Tensor('float32', frame, [1, frame.length]),
      state: new ort.Tensor('float32', stream.state, [2, 1, 128]),
      sr: new ort.Tensor('int64', BigInt64Array.of(BigInt(this.options.sampleRate)), [])
    };
    const results = await this.session.run(feeds);
    const probability = Number(results.output?.data[0]);
    const stateOutput = results.stateN ?? results.state;
    if (!Number.isFinite(probability) || !stateOutput) throw new Error('La salida del modelo Silero no cumple el contrato esperado.');
    stream.state = Float32Array.from(stateOutput.data);

    const wasSpeaking = stream.speaking;
    const frameMs = (frame.length / this.options.sampleRate) * 1000;
    if (probability >= this.options.threshold) {
      stream.lastSpeechAt = nowMs;
      if (!stream.speaking) {
        stream.speechStartAt ??= nowMs;
        if (nowMs - stream.speechStartAt + frameMs >= this.options.minSpeechMs) stream.speaking = true;
      }
    } else {
      stream.speechStartAt = null;
      if (stream.speaking && stream.lastSpeechAt !== null && nowMs - stream.lastSpeechAt >= this.options.silenceMs) {
        stream.speaking = false;
      }
    }

    const event = Object.freeze({
      probability,
      speaking: stream.speaking,
      speechStarted: !wasSpeaking && stream.speaking,
      speechEnded: wasSpeaking && !stream.speaking
    });
    if (event.speechEnded) stream.lastSpeechAt = null;
    return event;
  }

  reset(streamId) {
    if (streamId === undefined) this.streams.clear();
    else this.streams.delete(streamId);
  }

  async close() {
    await this.session?.release();
    this.session = null;
    this.reset();
  }
}