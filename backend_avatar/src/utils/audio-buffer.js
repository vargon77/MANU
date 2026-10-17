// @ts-check

/** @param {ArrayLike<number>} samples */
export function float32ToInt16(samples) {
  const output = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Number.isFinite(samples[index]) ? Math.max(-1, Math.min(1, samples[index])) : 0;
    output[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return output;
}

/** @param {ArrayLike<number>} samples */
export function int16ToFloat32(samples) {
  const output = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-32768, Math.min(32767, Math.trunc(samples[index])));
    output[index] = sample < 0 ? sample / 32768 : sample / 32767;
  }
  return output;
}

/** @param {ArrayBuffer | ArrayBufferView} input */
function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
}

/** @param {ArrayBuffer | ArrayBufferView} input */
export function toAlignedFloat32(input) {
  const bytes = bytesOf(input);
  const usableLength = bytes.byteLength - (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT);
  const aligned = new Uint8Array(usableLength);
  aligned.set(bytes.subarray(0, usableLength));
  return new Float32Array(aligned.buffer);
}

/** @param {ArrayBuffer | ArrayBufferView} input */
export function toAlignedInt16(input) {
  const bytes = bytesOf(input);
  const usableLength = bytes.byteLength - (bytes.byteLength % Int16Array.BYTES_PER_ELEMENT);
  const aligned = new Uint8Array(usableLength);
  aligned.set(bytes.subarray(0, usableLength));
  return new Int16Array(aligned.buffer);
}

/** @param {Int16Array | ArrayLike<number>} samples @param {number} sampleRate */
export function pcm16ToWav(samples, sampleRate) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 1 || sampleRate > 384000) {
    throw new RangeError('sampleRate debe ser un entero entre 1 y 384000.');
  }
  const pcm = samples instanceof Int16Array ? samples : Int16Array.from(samples);
  const dataLength = pcm.length * Int16Array.BYTES_PER_ELEMENT;
  const output = new ArrayBuffer(44 + dataLength);
  const view = new DataView(output);
  /** @param {number} offset @param {string} text */
  const writeAscii = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < pcm.length; index += 1) view.setInt16(44 + index * 2, pcm[index], true);
  return new Uint8Array(output);
}

export class FrameAssembler {
  /** @param {number} frameSize */
  constructor(frameSize = 512) {
    if (!Number.isSafeInteger(frameSize) || frameSize < 1) throw new RangeError('frameSize debe ser positivo.');
    this.frameSize = frameSize;
    /** @type {Float32Array} */
    this.pending = new Float32Array(0);
  }

  /** @param {Float32Array | ArrayLike<number>} samples */
  push(samples) {
    const incoming = samples instanceof Float32Array ? samples : Float32Array.from(samples);
    const combined = new Float32Array(this.pending.length + incoming.length);
    combined.set(this.pending);
    combined.set(incoming, this.pending.length);
    const frameCount = Math.floor(combined.length / this.frameSize);
    const frames = [];
    for (let index = 0; index < frameCount; index += 1) {
      frames.push(combined.slice(index * this.frameSize, (index + 1) * this.frameSize));
    }
    this.pending = combined.slice(frameCount * this.frameSize);
    return frames;
  }

  flush() {
    const tail = this.pending;
    this.pending = new Float32Array(0);
    return tail;
  }

  reset() {
    this.pending = new Float32Array(0);
  }
}

export class RingBuffer {
  /** @param {number} capacity */
  constructor(capacity) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new RangeError('capacity debe ser positivo.');
    this.buffer = new Float32Array(capacity);
    this.writeIndex = 0;
    this.length = 0;
  }

  /** @param {ArrayLike<number>} samples */
  push(samples) {
    for (let index = 0; index < samples.length; index += 1) {
      this.buffer[this.writeIndex] = Number.isFinite(samples[index]) ? samples[index] : 0;
      this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
      this.length = Math.min(this.length + 1, this.buffer.length);
    }
  }

  toFloat32Array() {
    const output = new Float32Array(this.length);
    const start = (this.writeIndex - this.length + this.buffer.length) % this.buffer.length;
    for (let index = 0; index < this.length; index += 1) output[index] = this.buffer[(start + index) % this.buffer.length];
    return output;
  }

  clear() {
    this.writeIndex = 0;
    this.length = 0;
  }
}

/** @param {Iterable<ArrayBuffer | ArrayBufferView>} chunks */
export function concatenateBytes(chunks) {
  const arrays = Array.from(chunks, bytesOf);
  const output = new Uint8Array(arrays.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of arrays) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}