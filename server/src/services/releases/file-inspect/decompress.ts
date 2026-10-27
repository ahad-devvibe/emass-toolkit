import { constants, unzipSync, zstdDecompressSync } from "node:zlib";
import xz from "xz-decompress";
import { BudgetExceeded } from "./range-reader.js";

/** Metadata we decompress is a few KB; anything far larger isn't worth reading. */
export const MAX_DECOMPRESSED = 8 * 1024 * 1024;

function tooLarge(error: unknown) {
  return (
    error instanceof RangeError ||
    (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

/** gzip or zlib (unzip detects which). Throws on corrupt input. */
export function inflate(data: Uint8Array): Uint8Array {
  try {
    return unzipSync(data, { maxOutputLength: MAX_DECOMPRESSED });
  } catch (error) {
    if (tooLarge(error)) throw new BudgetExceeded("Inflated data too large");
    throw error;
  }
}

/**
 * A PDF stream: zlib, but often followed by junk or cut short, so whatever
 * inflates before the error is kept.
 */
export function inflateLenient(data: Uint8Array): Uint8Array {
  try {
    return unzipSync(data, {
      maxOutputLength: MAX_DECOMPRESSED,
      finishFlush: constants.Z_SYNC_FLUSH,
    });
  } catch (error) {
    if (tooLarge(error)) throw new BudgetExceeded("Inflated data too large");
    throw error;
  }
}

export function unzstd(data: Uint8Array): Uint8Array {
  try {
    return zstdDecompressSync(data, { maxOutputLength: MAX_DECOMPRESSED });
  } catch (error) {
    if (tooLarge(error))
      throw new BudgetExceeded("Decompressed data too large");
    throw error;
  }
}

/** xz has no Node built-in; xz-decompress is WebAssembly, no native code. */
export async function unxz(data: Uint8Array): Promise<Uint8Array> {
  const reader = new xz.XzReadableStream(
    new Blob([new Uint8Array(data)]).stream(),
  ).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_DECOMPRESSED) {
      await reader.cancel();
      throw new BudgetExceeded("Decompressed data too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
