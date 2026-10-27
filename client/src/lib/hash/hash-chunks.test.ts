import { createSHA256 } from "hash-wasm"
import { describe, expect, it } from "vitest"
import { HASH_CHUNK_BYTES, hashChunks } from "./hash-chunks"

/** WebCrypto's one-shot digest, as the reference. */
async function reference(bytes: Uint8Array<ArrayBuffer>) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

describe("hashChunks", () => {
  it("matches WebCrypto's SHA-256 across several chunks, reporting progress up to the size", async () => {
    const size = HASH_CHUNK_BYTES * 2 + 12345
    const bytes = new Uint8Array(size)
    for (let i = 0; i < size; i++) bytes[i] = (i * 31) % 251
    const progress: number[] = []

    const sha256 = await hashChunks(new Blob([bytes]), await createSHA256(), (hashed) => progress.push(hashed))

    expect(sha256).toBe(await reference(bytes))
    expect(progress).toEqual([HASH_CHUNK_BYTES, HASH_CHUNK_BYTES * 2, size])
  })

  it("hashes an empty file", async () => {
    expect(await hashChunks(new Blob([]), await createSHA256())).toBe(await reference(new Uint8Array(0)))
  })
})
