import { ApiRequestError } from "@/lib/api/http"
import { fromApiPlatform, toFileIssue, type ApiFileIssue, type ApiPlatform } from "./releases.mappers"
import type { FileIssue, PlatformDuplicate } from "./releases.model"

/** The id of the file that already holds the platform, from a PLATFORM_TAKEN error. */
export function platformTakenBy(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== "PLATFORM_TAKEN") return null
  return typeof error.details.fileId === "string" ? error.details.fileId : null
}

/** The highest shipped version, from a VERSION_NOT_NEWER error. */
export function highestShipped(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.code !== "VERSION_NOT_NEWER") return null
  return typeof error.details.highestShipped === "string" ? error.details.highestShipped : null
}

/** Platforms set on several files, from a DUPLICATE_PLATFORM error on save. */
export function duplicatePlatforms(error: unknown): PlatformDuplicate[] {
  if (!(error instanceof ApiRequestError) || error.code !== "DUPLICATE_PLATFORM" || !Array.isArray(error.details.duplicates)) return []
  return (error.details.duplicates as { platform: ApiPlatform; fileIds: string[] }[]).map((duplicate) => ({ os: fromApiPlatform(duplicate.platform), fileIds: duplicate.fileIds }))
}

export type OpenUpload = { uploadId: string; name: string; startedBy: string }

/** The uploads still open on a draft, from an UPLOADS_IN_PROGRESS error on publish. */
export function uploadsInProgress(error: unknown): OpenUpload[] | null {
  if (!(error instanceof ApiRequestError) || error.code !== "UPLOADS_IN_PROGRESS" || !Array.isArray(error.details.uploads)) return null
  return error.details.uploads as OpenUpload[]
}

/** Why a file can't be added, from a FILE_BLOCKED error on check or upload. */
export function fileBlockedReasons(error: unknown): FileIssue[] | null {
  if (!(error instanceof ApiRequestError) || error.code !== "FILE_BLOCKED" || !Array.isArray(error.details.reasons)) return null
  return (error.details.reasons as ApiFileIssue[]).map(toFileIssue)
}
