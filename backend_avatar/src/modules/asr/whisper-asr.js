// @ts-check
import { LocalHttpService } from '../../utils/process.js';
import { pcm16ToWav } from '../../utils/audio-buffer.js';

export class WhisperAsr {
  /** @param {{ binary: string, model: string, host: string, port: number, timeoutMs: number, sampleRate: number }} options */
  constructor(options) {
    this.options = options;
    this.endpoint = `http://${options.host}:${options.port}`;
    this.service = new LocalHttpService({
      binary: options.binary,
      args: ['--host', options.host, '--port', String(options.port), '-m', options.model],
      healthUrl: `${this.endpoint}/`,
      timeoutMs: options.timeoutMs
    });
  }

  start() {
    return this.service.start();
  }

  /** @param {Int16Array} pcm @param {{ signal?: AbortSignal, language?: string }} [options] */
  async transcribe(pcm, options = {}) {
    this.service.assertAlive();
    if (!(pcm instanceof Int16Array) || pcm.length === 0) throw new TypeError('Whisper requiere audio PCM16 no vacío.');
    const wav = pcm16ToWav(pcm, this.options.sampleRate);
    const form = new FormData();
    form.set('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav');
    form.set('response_format', 'json');
    if (options.language) form.set('language', options.language);
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.options.timeoutMs),
      ...(options.signal ? [options.signal] : [])
    ]);
    const response = await fetch(`${this.endpoint}/inference`, { method: 'POST', body: form, signal });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 2000);
      throw new Error(`Whisper respondió HTTP ${response.status}: ${detail}`);
    }
    const body = await response.json();
    if (!body || typeof body.text !== 'string') throw new Error('Respuesta de Whisper inválida: falta text.');
    return body.text.trim();
  }

  stop() {
    return this.service.stop();
  }
}