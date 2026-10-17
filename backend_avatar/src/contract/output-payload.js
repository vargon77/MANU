// @ts-check

export const OUTPUT_MAGIC = 'AVTR';
export const OUTPUT_VERSION = 1;
export const OUTPUT_HEADER_BYTES = 20;
export const OUTPUT_FLAGS = Object.freeze({
  FINAL: 1,
  TRUNCATED: 2,
  HAS_VISEMES: 4
});

/**
 * AVTR v1 header (little-endian): magic[4], version u8, flags u8,
 * headerBytes u16, turnId u32, sampleRate u32, audioBytes u32; raw PCM16 follows.
 * @param {{ flags?: number, turnId: number, sampleRate: number, audio: Uint8Array }} payload
 */
export function encodeOutputPayload(payload) {
  const { flags = 0, turnId, sampleRate, audio } = payload;
  if (!Number.isInteger(flags) || flags < 0 || flags > 255) throw new RangeError('flags debe caber en uint8.');
  if (!Number.isSafeInteger(turnId) || turnId < 0 || turnId > 0xffffffff) throw new RangeError('turnId debe caber en uint32.');
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new RangeError('sampleRate fuera de rango.');
  if (!(audio instanceof Uint8Array) || audio.byteLength % 2 !== 0) throw new TypeError('audio debe contener bytes PCM16 completos.');
  const output = new Uint8Array(OUTPUT_HEADER_BYTES + audio.byteLength);
  const view = new DataView(output.buffer);
  for (let index = 0; index < OUTPUT_MAGIC.length; index += 1) view.setUint8(index, OUTPUT_MAGIC.charCodeAt(index));
  view.setUint8(4, OUTPUT_VERSION);
  view.setUint8(5, flags);
  view.setUint16(6, OUTPUT_HEADER_BYTES, true);
  view.setUint32(8, turnId, true);
  view.setUint32(12, sampleRate, true);
  view.setUint32(16, audio.byteLength, true);
  output.set(audio, OUTPUT_HEADER_BYTES);
  return output;
}

/** @param {ArrayBuffer | ArrayBufferView} input */
export function decodeOutputPayload(input) {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength < OUTPUT_HEADER_BYTES) throw new RangeError('Payload AVTR incompleto: falta la cabecera.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic !== OUTPUT_MAGIC) throw new TypeError('Magic AVTR inválido.');
  const version = view.getUint8(4);
  if (version !== OUTPUT_VERSION) throw new RangeError(`Versión AVTR no soportada: ${version}.`);
  const headerBytes = view.getUint16(6, true);
  const audioBytes = view.getUint32(16, true);
  if (headerBytes !== OUTPUT_HEADER_BYTES || headerBytes + audioBytes !== bytes.byteLength || audioBytes % 2 !== 0) {
    throw new RangeError('Longitudes del payload AVTR inválidas.');
  }
  return Object.freeze({
    version,
    flags: view.getUint8(5),
    turnId: view.getUint32(8, true),
    sampleRate: view.getUint32(12, true),
    audio: bytes.slice(headerBytes)
  });
}