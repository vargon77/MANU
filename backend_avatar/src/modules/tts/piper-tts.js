// @ts-check
import { readFile } from 'node:fs/promises';
import { runCommand } from '../../utils/process.js';
import { toAlignedInt16 } from '../../utils/audio-buffer.js';

export class PiperTts {
  /** @param {{ binary: string, model: string, timeoutMs: number, maxTextChars: number }} options */
  constructor(options) {
    this.options = options;
    this.sampleRate = null;
  }

  async initialize() {
    const sidecar = JSON.parse(await readFile(`${this.options.model}.json`, 'utf8'));
    const sampleRate = sidecar.audio?.sample_rate;
    if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 96000) {
      throw new Error('La configuración de Piper no declara un audio.sample_rate válido.');
    }
    this.sampleRate = sampleRate;
    return this;
  }

  /** @param {string} text @param {{ signal?: AbortSignal }} [options] */
  async synthesize(text, options = {}) {
    if (!this.sampleRate) throw new Error('PiperTts no está inicializado.');
    if (typeof text !== 'string' || !text.trim() || text.length > this.options.maxTextChars) {
      throw new RangeError(`El texto debe contener entre 1 y ${this.options.maxTextChars} caracteres.`);
    }
    const result = await runCommand(this.options.binary, ['--model', this.options.model, '--output_raw'], {
      input: `${text.trim()}\n`,
      timeoutMs: this.options.timeoutMs,
      signal: options.signal,
      maxOutputBytes: this.sampleRate * 2 * 180
    });
    const pcm = toAlignedInt16(result.stdout);
    if (pcm.length === 0) throw new Error('Piper no generó muestras de audio.');
    return Object.freeze({ pcm, sampleRate: this.sampleRate });
  }
}