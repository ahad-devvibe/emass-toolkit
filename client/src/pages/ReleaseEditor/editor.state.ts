import { ApiRequestError } from "@/lib/api/http"
import type { OperatingSystem } from "@/pages/Catalog/catalog.types"
import { highestShipped } from "@/pages/Releases/releases.errors"
import type { FileMapping, FileMappingChange, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { parseSemver } from "@/pages/Releases/version.utils"
import { hasConflicts, hasFailures, isBusy, type PlatformHolder, type QueueState } from "./upload-queue"

// Pure rules behind the release editor, kept out of the components so they're testable

/** Format only; uniqueness and "newer than shipped" are the server's call. */
export function versionProblem(input: string): string | null {
  const value = input.trim()
  if (!value) return "Enter a version number."
  if (!parseSemver(value)) return "Use MAJOR.MINOR.PATCH, for example 2.5.0."
  return null
}

/** The server's version errors, worded for the field. */
export function serverVersionProblem(error: unknown): string | null {
  const shipped = highestShipped(error)
  if (shipped) return `Must be newer than v${shipped}, the latest shipped version.`
  if (error instanceof ApiRequestError && error.code === "VERSION_TAKEN") return "This product already has a release with that version."
  if (error instanceof ApiRequestError && error.fieldErrors.version?.length) return error.fieldErrors.version[0]
  return null
}

export type EditorForm = { version: string; notes: string }

/** Only what changed, so Save draft never rewrites untouched fields. */
export function changedFields(saved: { version: string; releaseNotes: string }, form: EditorForm): { version?: string; releaseNotes?: string } {
  const changes: { version?: string; releaseNotes?: string } = {}
  const version = form.version.trim()
  if (version !== saved.version) changes.version = version
  if (form.notes !== saved.releaseNotes) changes.releaseNotes = form.notes
  return changes
}

/** What the save bar says is unsaved: "version · notes · 2 file types". */
export function unsavedSummary(fields: { version?: string; releaseNotes?: string }, fileChanges: number): string {
  const parts: string[] = []
  if (fields.version !== undefined) parts.push("version")
  if (fields.releaseNotes !== undefined) parts.push("notes")
  if (fileChanges > 0) parts.push(`${fileChanges} file ${fileChanges === 1 ? "type" : "types"}`)
  return parts.join(" · ")
}

// --- File type/platform mappings: edited locally, saved with the draft ---

/** Local edits by file id; anything absent shows the saved value. */
export type MappingOverrides = Record<string, FileMapping>

// Docs never carry a platform; an SDK may wait for one while drafting
const normalize = ({ kind, os }: FileMapping): FileMapping => ({ kind, os: kind === "sdk" ? os : null })

export function effectiveMapping(file: ReleaseFileItem, overrides: MappingOverrides): FileMapping {
  return normalize(overrides[file.id] ?? { kind: file.kind, os: file.os })
}

/** The `files` part of Save draft: only mappings that differ from what's saved. */
export function changedMappings(files: ReleaseFileItem[], overrides: MappingOverrides): FileMappingChange[] {
  return files.flatMap((file) => {
    if (!overrides[file.id]) return []
    const { kind, os } = effectiveMapping(file, overrides)
    return kind !== file.kind || os !== file.os ? [{ id: file.id, kind, os }] : []
  })
}

export type MappingProblem = { type: "duplicate"; os: OperatingSystem; others: string[] } | { type: "needsPlatform" } | { type: "needsType" }

/**
 * Live warnings per file while editing: a platform set on more than one
 * file, an SDK without a platform, a file without a type. Nothing here
 * blocks editing; duplicates block saving (the server would refuse them)
 * and every problem blocks Send for review.
 */
export function mappingProblems(files: ReleaseFileItem[], overrides: MappingOverrides): Record<string, MappingProblem> {
  const problems: Record<string, MappingProblem> = {}
  const byOs = new Map<OperatingSystem, ReleaseFileItem[]>()
  for (const file of files) {
    const { kind, os } = effectiveMapping(file, overrides)
    if (!kind) problems[file.id] = { type: "needsType" }
    else if (kind === "sdk" && !os) problems[file.id] = { type: "needsPlatform" }
    else if (os) byOs.set(os, [...(byOs.get(os) ?? []), file])
  }
  for (const [os, claimants] of byOs) {
    if (claimants.length < 2) continue
    for (const file of claimants) problems[file.id] = { type: "duplicate", os, others: claimants.filter((other) => other.id !== file.id).map((other) => other.name) }
  }
  return problems
}

export const hasDuplicates = (problems: Record<string, MappingProblem>) => Object.values(problems).some((problem) => problem.type === "duplicate")

/** The saved file that has `os` in the current (edited) mapping, for the upload queue's conflict check. */
export function savedHolderFor(files: ReleaseFileItem[], overrides: MappingOverrides, os: OperatingSystem): PlatformHolder | null {
  const holder = files.find((file) => {
    const mapping = effectiveMapping(file, overrides)
    return mapping.kind === "sdk" && mapping.os === os
  })
  return holder ? { fileId: holder.id, name: holder.name } : null
}

/** Why Send for review is blocked, or null when it can go. */
export function submitBlocker({ version, fileCount, queue, problems }: { version: string; fileCount: number; queue: QueueState; problems: Record<string, MappingProblem> }): string | null {
  const kinds = new Set(Object.values(problems).map((problem) => problem.type))
  if (versionProblem(version)) return "Fix the version number first."
  if (isBusy(queue)) return "Wait for uploads to finish."
  if (hasFailures(queue)) return "Retry or remove the failed uploads."
  if (hasConflicts(queue)) return "Replace or re-map the uploads held on a platform."
  if (kinds.has("duplicate")) return "Each platform can have only one SDK."
  if (kinds.has("needsType")) return "Choose a type for every file."
  if (kinds.has("needsPlatform")) return "Choose a platform for every SDK."
  if (fileCount === 0) return "Add at least one file."
  return null
}
