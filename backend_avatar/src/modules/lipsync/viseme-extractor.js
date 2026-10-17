// @ts-check
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCommand } from '../../utils/process.js';
import { pcm16ToWav } from '../../utils/audio-buffer.js';

export class VisemeExtractor {
  /** @param {{ binary: string, timeoutMs: number, maxOutputBytes?: number }} options */
  constructor(options) {
    this.options = { ...options, maxOutputBytes: options.maxOutputBytes ?? 2 * 1024 * 1024 };
  }

  /** @param {Int16Array} pcm @param {number} sampleRate @param {{ signal?: AbortSignal }} [options] */
  async extract(pcm, sampleRate, options = {}) {
    if (!(pcm instanceof Int16Array) || pcm.length === 0) throw new TypeError('Rhubarb requiere audio PCM16 no vacío.');
    const directory = await mkdtemp(join(tmpdir(), 'avatar-lipsync-'));
    const audioPath = join(directory, 'input.wav');
    const outputPath = join(directory, 'mouth-cues.json');
    try {
      await writeFile(audioPath, pcm16ToWav(pcm, sampleRate), { flag: 'wx' });
      await runCommand(this.options.binary, ['-f', 'json', '-r', 'phonetic', '-o', outputPath, audioPath], {
        timeoutMs: this.options.timeoutMs,
        signal: options.signal,
        maxOutputBytes: this.options.maxOutputBytes
      });
      const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
      if (!Array.isArray(parsed.mouthCues)) throw new Error('Rhubarb no devolvió mouthCues.');
      let previousEnd = 0;
      const cues = parsed.mouthCues.map((cue, index) => {
        if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < previousEnd || cue.end < cue.start || typeof cue.value !== 'string') {
          throw new Error(`Visema Rhubarb inválido en mouthCues[${index}].`);
        }
        previousEnd = cue.end;
        return Object.freeze({ start: cue.start, end: cue.end, value: cue.value });
      });
      return Object.freeze(cues);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}