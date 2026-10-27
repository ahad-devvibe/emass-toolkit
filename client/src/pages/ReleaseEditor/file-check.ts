import { ApiRequestError } from "@/lib/api/http"
import type { FileCheckInput, FileCheckResult, FileRange } from "@/pages/Releases/releases.api"

/** A verdict that lets the file through (a blocked file is a FILE_BLOCKED error). */
export type FileVerdict = Exclude<FileCheckResult, { status: "NEED_BYTES" }>
export type CheckRequest = { replace?: string; sha256?: string; ranges: FileRange[] }
export type CheckFn = (file: File, request: CheckRequest) => Promise<FileVerdict>

/** The server needs 2–6 rounds for any format; more means something is wrong. */
export const MAX_CHECK_ROUNDS = 8

/** Base64 without building one huge string for String.fromCharCode. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

/**
 * Asks the server to rule on a file before it uploads. The server reads the
 * file's own structure and says which byte ranges it needs; those are read
 * from disk (`File.slice`, nothing else) and sent back until it rules. The
 * ranges collect in `request.ranges`, so a later call (with the SHA-256)
 * resends them without reading the file again.
 */
export async function checkFile(api: (input: FileCheckInput) => Promise<FileCheckResult>, file: File, request: CheckRequest): Promise<FileVerdict> {
  for (let round = 0; round < MAX_CHECK_ROUNDS; round++) {
    const result = await api({ name: file.name, size: file.size, ranges: request.ranges, ...(request.sha256 && { sha256: request.sha256 }), ...(request.replace && { replace: request.replace }) })
    if (result.status !== "NEED_BYTES") return result
    for (const { offset, length } of result.ranges) {
      const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
      request.ranges.push({ offset, data: toBase64(bytes) })
    }
  }
  throw new ApiRequestError(0, "CHECK_RUNAWAY", "Couldn't finish checking this file. Try again.")
}
