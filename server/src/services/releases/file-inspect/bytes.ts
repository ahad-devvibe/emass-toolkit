const utf8Decoder = new TextDecoder("utf-8");
const utf16Decoder = new TextDecoder("utf-16le");
const utf16BeDecoder = new TextDecoder("utf-16be");

/**
 * One char per byte (true ISO-8859-1, unlike TextDecoder's windows-1252), so
 * string offsets equal byte offsets and `latin1Bytes` restores the bytes.
 */
export const latin1 = (bytes: Uint8Array) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    "latin1",
  );
export const latin1Bytes = (text: string): Uint8Array =>
  Buffer.from(text, "latin1");
export const utf8 = (bytes: Uint8Array) => utf8Decoder.decode(bytes);
export const utf16le = (bytes: Uint8Array) => utf16Decoder.decode(bytes);
export const utf16be = (bytes: Uint8Array) => utf16BeDecoder.decode(bytes);

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

export const u16le = (bytes: Uint8Array, at: number) =>
  view(bytes).getUint16(at, true);
export const u32le = (bytes: Uint8Array, at: number) =>
  view(bytes).getUint32(at, true);
export const u16be = (bytes: Uint8Array, at: number) =>
  view(bytes).getUint16(at, false);
export const u32be = (bytes: Uint8Array, at: number) =>
  view(bytes).getUint32(at, false);

/** A big-endian u64 as a number; null past Number.MAX_SAFE_INTEGER. */
export function u64be(bytes: Uint8Array, at: number): number | null {
  const value = view(bytes).getBigUint64(at, false);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

export function startsWith(bytes: Uint8Array, prefix: string, at = 0) {
  if (bytes.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) {
    if (bytes[at + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}
