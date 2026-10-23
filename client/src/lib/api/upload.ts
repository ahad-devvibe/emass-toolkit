import { API_BASE, ApiRequestError, parseEnvelope } from "./http"

export type UploadProgress = (loaded: number, total: number) => void
export type UploadOptions = { onProgress?: UploadProgress; signal?: AbortSignal }

export const uploadCancelled = () => new ApiRequestError(0, "CANCELLED", "The upload was cancelled.")

/**
 * Multipart POST over XMLHttpRequest, because fetch can't report upload
 * progress. Fields are appended before the file (the server needs them
 * first); the response goes through the same envelope parsing as apiRequest.
 * Progress reaches `total` once the bytes are sent; the server then still
 * commits the object, so callers show "Finalizing" until this resolves.
 */
export function uploadMultipart<T>(path: string, fields: [string, string][], file: File, { onProgress, signal }: UploadOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(uploadCancelled())
      return
    }

    const form = new FormData()
    for (const [name, value] of fields) form.append(name, value)
    form.append("file", file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", `${API_BASE}${path}`)
    xhr.responseType = "text"
    xhr.setRequestHeader("Accept", "application/json")

    const onAbort = () => xhr.abort()
    signal?.addEventListener("abort", onAbort, { once: true })
    const settle = () => signal?.removeEventListener("abort", onAbort)

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total)
    }
    xhr.upload.onload = () => onProgress?.(file.size, file.size)

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

    xhr.send(form)
  })
}
