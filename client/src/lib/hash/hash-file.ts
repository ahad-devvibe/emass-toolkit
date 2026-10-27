import { ApiRequestError } from "@/lib/api/http"
import type { HashMessage } from "./sha256.worker"

export type HashOptions = { onProgress?: (hashed: number) => void; signal?: AbortSignal }
export type HashFn = (file: File, options?: HashOptions) => Promise<string>

export const hashCancelled = () => new ApiRequestError(0, "CANCELLED", "The check was cancelled.")
const hashFailed = () => new ApiRequestError(0, "HASH_FAILED", "Couldn't read this file to check it. Try again.")

/**
 * The file's SHA-256, computed in a Web Worker (one per file), so hashing a
 * large installer never blocks the page. Aborting stops the worker at once.
 */
export const hashFile: HashFn = (file, { onProgress, signal } = {}) =>
  new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(hashCancelled())
      return
    }
    let worker: Worker
    try {
      worker = new Worker(new URL("./sha256.worker.ts", import.meta.url), { type: "module" })
    } catch {
      reject(hashFailed())
      return
    }
    const finish = () => {
      worker.terminate()
      signal?.removeEventListener("abort", onAbort)
    }
    const onAbort = () => {
      finish()
      reject(hashCancelled())
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    worker.onmessage = ({ data }: MessageEvent<HashMessage>) => {
      if (data.type === "progress") return onProgress?.(data.hashed)
      finish()
      if (data.type === "done") resolve(data.sha256)
      else reject(hashFailed())
    }
    worker.onerror = () => {
      finish()
      reject(hashFailed())
    }
    worker.postMessage({ file })
  })
