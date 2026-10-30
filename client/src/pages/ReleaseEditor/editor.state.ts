import { ApiRequestError } from "@/lib/api/http"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { highestShipped } from "@/pages/Releases/releases.errors"
import type { FileMapping, FileMappingChange, ReleaseFileItem, ReleaseSummary } from "@/pages/Releases/releases.model"
import type { ReleaseStatus } from "@/pages/Releases/releases.types"
import { parseSemver, releaseTitle } from "@/pages/Releases/version.utils"
import { forRelease, hasConflicts, hasFailures, hasUnfinished, isBusy, overall, type PlatformHolder, type QueueState } from "@/features/uploads/uploads.state"

// Pure rules behind the release editor, kept out of the components so they're testable

/** Format only; uniqueness and "newer than shipped" are the server's call. */
export function versionProblem(input: string): string | null {
  const value = input.trim()
  if (!value) return "Enter a version number."
  if (!parseSemver(value)) return "Use MAJOR.MINOR.PATCH, for example 2.5.0."
  return null
}

/** A draft may be saved without a version (it's needed to submit), but not with a malformed one. */
export const draftVersionProblem = (input: string): string | null => (input.trim() ? versionProblem(input) : null)

/** One file's say on the version: its type, and the versions found in its name or contents. */
export type VersionSource = { kind: FileKind | null; versions: string[] }

/**
 * The version the SDK files agree on. Docs never count (a guide's own
 * version says nothing about the build), and an SDK without a version
 * doesn't object. Exactly one version → `detected`; `candidates` lists
 * them all, for suggestions when they disagree.
 */
export function versionFromSdks(sources: VersionSource[]): { detected: string | null; candidates: string[] } {
  const candidates = [...new Set(sources.filter((source) => source.kind === "sdk").flatMap((source) => source.versions))]
  return { detected: candidates.length === 1 ? candidates[0] : null, candidates }
}

/** The server's version errors, worded for the field. */
export function serverVersionProblem(error: unknown): string | null {
  const shipped = highestShipped(error)
  if (shipped) return `Must be newer than v${shipped}, the latest shipped version.`
  if (error instanceof ApiRequestError && error.code === "VERSION_TAKEN") return "This product already has a release with that version."
  if (error instanceof ApiRequestError && error.fieldErrors.version?.length) return error.fieldErrors.version[0]
  return null
}

export type EditorForm = { productId: string; version: string; notes: string }

/** Save draft's fields: an empty version is sent as null ("no version yet"). */
export type FieldChanges = { productId?: string; version?: string | null; releaseNotes?: string }

/** Only what changed, so Save draft never rewrites untouched fields. */
export function changedFields(saved: { product: { id: string }; version: string | null; releaseNotes: string }, form: EditorForm): FieldChanges {
  const changes: FieldChanges = {}
  if (form.productId !== saved.product.id) changes.productId = form.productId
  const version = form.version.trim() || null
  if (version !== saved.version) changes.version = version
  if (form.notes !== saved.releaseNotes) changes.releaseNotes = form.notes
  return changes
}

/** What the save bar says is unsaved: "product · version · notes · 2 file types". */
export function unsavedSummary(fields: FieldChanges, fileChanges: number): string {
  const parts: string[] = []
  if (fields.productId !== undefined) parts.push("product")
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
/**
 * Why Send for review can't go ahead yet, or null. `blockedFiles` counts saved
 * files the server's rules now refuse (e.g. installers of another version).
 */
export function submitBlocker({ version, fileCount, queue, problems, blockedFiles = 0 }: { version: string; fileCount: number; queue: QueueState; problems: Record<string, MappingProblem>; blockedFiles?: number }): string | null {
  const kinds = new Set(Object.values(problems).map((problem) => problem.type))
  if (versionProblem(version)) return "Fix the version number first."
  if (isBusy(queue)) return "Wait for uploads to finish."
  if (hasUnfinished(queue)) return "Resume or cancel the paused uploads."
  if (hasFailures(queue)) return "Retry or remove the failed uploads."
  if (hasConflicts(queue)) return "Replace or re-map the uploads held on a platform."
  if (blockedFiles > 0) return "Remove the files that can't be submitted, or change the version."
  if (kinds.has("duplicate")) return "Each platform can have only one SDK."
  if (kinds.has("needsType")) return "Choose a type for every file."
  if (kinds.has("needsPlatform")) return "Choose a platform for every SDK."
  if (fileCount === 0) return "Add at least one file."
  return null
}

export type DraftToContinue = {
  id: string
  label: string
  /** Null for a draft known only from this tab's uploads (not listed yet). */
  status: ReleaseStatus | null
  updatedAt: string | null
  /** "2 files uploading (61%)", "1 paused", …; null when nothing is uploading. */
  uploads: string | null
}

const OPEN_STATUSES: ReleaseStatus[] = ["draft", "changes_requested"]

/** What this tab is doing for one release's files, in a few words. */
export function uploadsText(state: QueueState, releaseId: string): string | null {
  const mine = forRelease(state, releaseId)
  const count = (statuses: string[]) => mine.items.filter((item) => statuses.includes(item.status)).length
  const moving = count(["queued", "checking", "hashing", "uploading", "finalizing", "waiting"])
  if (moving > 0) {
    const { loadedBytes, totalBytes } = overall({ ...mine, items: mine.items.filter((item) => item.status !== "done") })
    const percent = totalBytes ? Math.floor((loadedBytes / totalBytes) * 100) : 0
    return `${moving} ${moving === 1 ? "file" : "files"} uploading (${percent}%)`
  }
  const parts = [
    [count(["paused"]), "paused"],
    [count(["needsFile"]), "waiting for a file"],
    [count(["failed"]), "failed"],
  ] as const
  const said = parts.filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`)
  return said.length ? said.join(" · ") : null
}

/**
 * The developer's releases still being worked on, for "Continue your draft"
 * on New Release: drafts this tab is uploading to first (they may not be
 * listed yet), then their open drafts with uploads, then the rest, newest first.
 */
export function draftsToContinue(releases: ReleaseSummary[], uploads: QueueState, userId: string, limit = 3): DraftToContinue[] {
  const listed = releases
    .filter((release) => release.createdBy.id === userId && OPEN_STATUSES.includes(release.status))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const listedIds = new Set(listed.map((release) => release.id))
  const active = new Set(uploads.items.filter((item) => !["done", "cancelled", "blocked"].includes(item.status)).map((item) => item.releaseId))

  const unlisted: DraftToContinue[] = [...active]
    .filter((id) => !listedIds.has(id))
    .map((id) => ({ id, label: uploads.items.find((item) => item.releaseId === id)?.releaseLabel || "Draft", status: null, updatedAt: null, uploads: uploadsText(uploads, id) }))
  const known: DraftToContinue[] = listed.map((release) => ({ id: release.id, label: `${releaseTitle(release)}`, status: release.status, updatedAt: release.updatedAt, uploads: uploadsText(uploads, release.id) }))
  // Uploading ones first: that's what someone coming back is looking for
  return [...unlisted, ...known.filter((draft) => draft.uploads), ...known.filter((draft) => !draft.uploads)].slice(0, limit)
}

type ProductItem = { value: string; label: string }

/**
 * Product dropdown items. The release's own product is always there, so the
 * field shows its name (never its id) before the list loads, and when it's
 * no longer in the active list.
 */
export function productOptions(products: { id: string; name: string }[] | null, current: { id: string; name: string }): ProductItem[] {
  const items = (products ?? []).map((product) => ({ value: product.id, label: product.name }))
  return items.some((item) => item.value === current.id) ? items : [{ value: current.id, label: current.name }, ...items]
}
