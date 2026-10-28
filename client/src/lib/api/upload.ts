import { API_BASE, ApiRequestError, parseEnvelope } from "./http"

export type UploadProgress = (loaded: number, total: number) => void
export type UploadOptions = { onProgress?: UploadProgress; signal?: AbortSignal }

export const uploadCancelled = () => new ApiRequestError(0, "CANCELLED", "The upload was cancelled.")

/**
 * Sends a raw Blob (one piece of a file) over XMLHttpRequest, because fetch
 * can't report upload progress. The response goes through the same envelope
 * parsing as apiRequest. Progress reaches `total` once the bytes are sent; the
 * server then still stores them, so callers wait for this to resolve.
 */
export function sendBlob<T>(method: "PUT" | "POST", path: string, body: Blob, { onProgress, signal }: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(uploadCancelled())
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(method, `${API_BASE}${path}`)
    xhr.responseType = "text"
    xhr.withCredentials = true
    xhr.setRequestHeader("Accept", "application/json")
    xhr.setRequestHeader("Content-Type", "application/octet-stream")

    const onAbort = () => xhr.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    const settle = () => signal?.removeEventListener("abort", onAbort)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.upload.onload = () => onProgress?.(body.size, body.size)

    xhr.onload = () => {
      settle()
      let payload: unknown = null
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        // Not JSON: parseEnvelope reports SERVER_UNAVAILABLE
      }
      try {
        resolve(parseEnvelope<T>(xhr.status, payload))
      } catch (error) {
        reject(error)
      }
    }
    xhr.onerror = () => {
      settle()
      reject(new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again."))
    }
    xhr.onabort = () => {
      settle()
      reject(uploadCancelled())
    }

    xhr.send(body)
  })
}
