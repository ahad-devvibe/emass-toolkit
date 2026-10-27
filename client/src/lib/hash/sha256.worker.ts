import { createSHA256 } from "hash-wasm"
import { hashChunks } from "./hash-chunks"

// Hashes one file off the main thread, so a 600 MB file never freezes the page
export type HashMessage = { type: "progress"; hashed: number } | { type: "done"; sha256: string } | { type: "error"; message: string }

const post = (message: HashMessage) => self.postMessage(message)

self.onmessage = async (event: MessageEvent<{ file: Blob }>) => {
  try {
    const sha256 = await hashChunks(event.data.file, await createSHA256(), (hashed) => post({ type: "progress", hashed }))
    post({ type: "done", sha256 })
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) })
  }
}
