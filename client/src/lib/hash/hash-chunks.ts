import type { IHasher } from "hash-wasm"

/** Read this much of the file at a time: memory stays at one chunk, whatever the file's size. */
export const HASH_CHUNK_BYTES = 8 * 1024 * 1024

/**
 * SHA-256 of a file read from disk in chunks (`Blob.slice` reads lazily, so
 * nothing else is held). The next chunk is read while the current one is
 * hashed, so at most two chunks are in memory. `onProgress` gets the bytes
 * hashed so far.
 */
export async function hashChunks(file: Blob, hasher: IHasher, onProgress?: (hashed: number) => void): Promise<string> {
  const read = (at: number) => file.slice(at, Math.min(at + HASH_CHUNK_BYTES, file.size)).arrayBuffer()
  hasher.init()
  let next = file.size > 0 ? read(0) : null
  for (let at = 0; next; at += HASH_CHUNK_BYTES) {
    const chunk = await next
    next = at + HASH_CHUNK_BYTES < file.size ? read(at + HASH_CHUNK_BYTES) : null
    hasher.update(new Uint8Array(chunk))
    onProgress?.(at + chunk.byteLength)
  }
  return hasher.digest("hex")
}
