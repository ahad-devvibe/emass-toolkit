import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { FileIssue, PublishJob, ReleaseFileItem } from "@/pages/Releases/releases.model"
import type { FileHandle } from "./file-source"

// The app-wide uploads state: a pure reducer plus selectors. Release files
// upload piece by piece and outlive the page that started them; admins'
// publish jobs are followed here too. uploads.store.ts runs it.
//
// Every dropped file is checked, then uploads, typed or not (an undetected
// file uploads unmapped and gets its type in the editor). Checking asks the
// server to rule on the file's versions, hashes it in a worker, then asks
// again with the hash: a blocked file never uploads. A file detected for a
// platform another file of its release already has waits as a "conflict"
// first, until the uploader replaces that file or changes its mapping.

export type QueueStatus =
  | "conflict"
  | "queued"
  | "checking"
  | "hashing"
  | "uploading"
  | "finalizing"
  /** Stopped by the uploader; the parts sent so far stay on the server. */
  | "paused"
  /** Offline, or retrying after a network error (see `retryAt`). */
  | "waiting"
  /** Restored after a refresh: the file must be opened again to go on. */
  | "needsFile"
  | "done"
  | "failed"
  | "cancelled"
  | "blocked"

export type QueueError = { code: string; message: string }

/** Why a waiting upload is retrying: the browser is offline, the connection dropped, or the server failed. */
export type RetryReason = { kind: "offline" | "network" | "server"; message: string; attempt: number }

/** Who already has the platform: a saved file (with id) or another upload of the release. */
export type PlatformHolder = { fileId: string | null; name: string | null }

export type QueueItem = {
  localId: string
  releaseId: string
  /** "EMASS IDE v1.135.0", for rows shown away from the release. */
  releaseLabel: string
  /** Null after a refresh until the file is opened again. */
  file: File | null
  /** Lets Chrome and Edge reopen the file after a refresh with one click. */
  handle: FileHandle | null
  name: string
  sizeBytes: number
  lastModified: number
  kind: FileKind | null
  os: OperatingSystem | null
  replaceFileId: string | null
  status: QueueStatus
  loaded: number
  /** Bytes hashed so far, while hashing. */
  hashed: number
  /** Known once hashed; kept for a retry unless the server saw other bytes. */
  sha256: string | null
  /** The server's upload session, once opened; resuming reuses it. */
  uploadId: string | null
  /** Re-hash before resuming: the file was picked again and may have changed. */
  verifyHash: boolean
  /** When a waiting upload tries again (ms since epoch); null while offline. */
  retryAt: number | null
  /** What the last try ran into, while waiting. */
  retryReason: RetryReason | null
  holder: PlatformHolder | null
  error: QueueError | null
  /** Why the server refuses the file (status "blocked"). */
  blockedBy: FileIssue[]
  /** What the check said to look at; the file still uploads. */
  warnings: FileIssue[]
  result: ReleaseFileItem | null
}

/** An admin's publish job, followed from any page. */
export type PublishItem = {
  releaseId: string
  releaseLabel: string
  job: PublishJob | null
  /** The server lost the job (restart) while the release was still in review. */
  interrupted: boolean
}

export type QueueState = { items: QueueItem[]; publishes: PublishItem[] }

/** What a new or restored upload starts from. */
export type NewItem = Pick<QueueItem, "localId" | "releaseId" | "releaseLabel" | "kind" | "os" | "holder"> & { file: File; handle: FileHandle | null }

export type RestoredItem = Pick<QueueItem, "localId" | "releaseId" | "releaseLabel" | "name" | "sizeBytes" | "lastModified" | "kind" | "os" | "replaceFileId" | "sha256" | "uploadId" | "warnings" | "handle">

export type QueueAction =
  | { type: "added"; items: NewItem[] }
  | { type: "restored"; items: RestoredItem[] }
  | { type: "mapped"; localId: string; kind: FileKind | null; os: OperatingSystem | null; holder: PlatformHolder | null }
  | { type: "started"; localId: string }
  | { type: "hashing"; localId: string; warnings: FileIssue[] }
  | { type: "hashProgressed"; localId: string; hashed: number }
  | { type: "hashed"; localId: string; sha256: string }
  | { type: "allowed"; localId: string; warnings: FileIssue[] }
  | { type: "blocked"; localId: string; reasons: FileIssue[] }
  | { type: "sessionOpened"; localId: string; uploadId: string; loaded: number }
  | { type: "sessionLost"; localId: string }
  | { type: "progressed"; localId: string; loaded: number }
  | { type: "waiting"; localId: string; retryAt: number | null; reason: RetryReason }
  | { type: "reconnected"; localId: string }
  | { type: "finalizing"; localId: string }
  | { type: "succeeded"; localId: string; file: ReleaseFileItem }
  | { type: "failed"; localId: string; error: QueueError; forgetHash?: boolean }
  | { type: "conflicted"; localId: string; holder: PlatformHolder }
  | { type: "paused"; localId: string }
  | { type: "resumed"; localId: string }
  | { type: "fileReattached"; localId: string; file: File; handle: FileHandle | null; keepSession: boolean; verifyHash: boolean }
  | { type: "wrongFile"; localId: string; error: QueueError }
  | { type: "cancelled"; localId: string }
  | { type: "retried"; localId: string }
  | { type: "replaceRequested"; localId: string }
  | { type: "dismissed"; localId: string }
  | { type: "publishTracked"; releaseId: string; releaseLabel: string; job: PublishJob | null }
  | { type: "publishUpdated"; releaseId: string; job: PublishJob; releaseLabel?: string }
  | { type: "publishInterrupted"; releaseId: string }
  | { type: "publishDismissed"; releaseId: string }
  /** The release was deleted: its uploads and publish job go with it. */
  | { type: "releaseForgotten"; releaseId: string }
  | { type: "reset" }

export const emptyQueue: QueueState = { items: [], publishes: [] }

/** Statuses that hold one of the upload slots. */
export const ACTIVE: QueueStatus[] = ["checking", "hashing", "uploading", "finalizing", "waiting"]
const STOPPABLE: QueueStatus[] = ["queued", ...ACTIVE]

// Docs never carry a platform; an SDK without one is fine (chosen later)
const normalize = (kind: FileKind | null, os: OperatingSystem | null) => ({ kind, os: kind === "sdk" ? os : null })

const fresh = {
  loaded: 0,
  hashed: 0,
  retryAt: null,
  retryReason: null,
  error: null,
  blockedBy: [],
  result: null,
  verifyHash: false,
} satisfies Partial<QueueItem>

// Each transition names the statuses it may start from; anything else is a
// late event (e.g. progress after a cancel) and leaves the item unchanged
function update(state: QueueState, localId: string, from: QueueStatus[], change: (item: QueueItem) => Partial<QueueItem>): QueueState {
  let changed = false
  const items = state.items.map((item) => {
    if (item.localId !== localId || !from.includes(item.status)) return item
    const patch = change(item)
    if (Object.keys(patch).length === 0) return item
    changed = true
    return { ...item, ...patch }
  })
  return changed ? { ...state, items } : state
}

function updatePublish(state: QueueState, releaseId: string, change: (item: PublishItem) => PublishItem | null): QueueState {
  const at = state.publishes.findIndex((item) => item.releaseId === releaseId)
  if (at < 0) return state
  const next = change(state.publishes[at])
  const publishes = [...state.publishes]
  if (next) publishes[at] = next
  else publishes.splice(at, 1)
  return { ...state, publishes }
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "added":
      return {
        ...state,
        items: [
          ...state.items,
          ...action.items.map(({ file, holder, kind, os, ...rest }) => ({
            ...rest,
            ...fresh,
            file,
            name: file.name,
            sizeBytes: file.size,
            lastModified: file.lastModified,
            ...normalize(kind, os),
            replaceFileId: null,
            status: holder ? ("conflict" as const) : ("queued" as const),
            sha256: null,
            uploadId: null,
            holder,
            warnings: [],
          })),
        ],
      }
    case "restored": {
      const known = new Set(state.items.map((item) => item.localId))
      const items = action.items.filter((item) => !known.has(item.localId)).map((item) => ({ ...item, ...fresh, file: null, status: "needsFile" as const, holder: null }))
      return items.length ? { ...state, items: [...state.items, ...items] } : state
    }
    case "mapped":
      return update(state, action.localId, ["conflict", "failed"], () => ({
        ...normalize(action.kind, action.os),
        status: action.holder ? "conflict" : "queued",
        holder: action.holder,
        replaceFileId: null,
        // A new mapping is a new session: the server keys it by these details
        uploadId: null,
        loaded: 0,
        error: null,
      }))
    case "started":
      return update(state, action.localId, ["queued"], () => ({ status: "checking", error: null, retryAt: null }))
    case "hashing":
      return update(state, action.localId, ["checking"], () => ({ status: "hashing", hashed: 0, warnings: action.warnings }))
    case "hashProgressed":
      return update(state, action.localId, ["hashing"], (item) => ({ hashed: Math.min(action.hashed, item.sizeBytes) }))
    case "hashed":
      return update(state, action.localId, ["hashing"], () => ({ status: "checking", sha256: action.sha256, verifyHash: false }))
    case "allowed":
      return update(state, action.localId, ["checking"], () => ({ status: "uploading", loaded: 0, warnings: action.warnings }))
    case "blocked":
      return update(state, action.localId, ACTIVE, () => ({ status: "blocked", blockedBy: action.reasons }))
    case "sessionOpened":
      return update(state, action.localId, ["uploading", "checking"], (item) => ({ status: "uploading", uploadId: action.uploadId, loaded: Math.min(action.loaded, item.sizeBytes) }))
    case "sessionLost":
      return update(state, action.localId, ACTIVE, () => ({ uploadId: null, loaded: 0 }))
    case "progressed":
      return update(state, action.localId, ["uploading"], (item) => ({ loaded: Math.min(action.loaded, item.sizeBytes) }))
    case "waiting":
      return update(state, action.localId, ["checking", "uploading", "finalizing", "waiting"], () => ({ status: "waiting", retryAt: action.retryAt, retryReason: action.reason }))
    case "reconnected":
      return update(state, action.localId, ["waiting"], (item) => ({ status: item.loaded >= item.sizeBytes ? "finalizing" : "uploading", retryAt: null, retryReason: null }))
    case "finalizing":
      return update(state, action.localId, ["uploading", "waiting"], (item) => ({ status: "finalizing", loaded: item.sizeBytes, retryAt: null }))
    case "succeeded":
      // Also from "cancelled" (a cancel that lost the race still created the
      // file) and "checking" (a retry found the earlier attempt had landed)
      return update(state, action.localId, [...ACTIVE, "cancelled", "paused"], (item) => ({ status: "done", loaded: item.sizeBytes, result: action.file, error: null, holder: null, retryAt: null }))
    case "failed":
      return update(state, action.localId, ACTIVE, (item) => ({ status: "failed", error: action.error, retryAt: null, sha256: action.forgetHash ? null : item.sha256, uploadId: action.forgetHash ? null : item.uploadId }))
    case "conflicted":
      // The server's backstop: another upload took the platform first
      return update(state, action.localId, ACTIVE, () => ({ status: "conflict", holder: action.holder, loaded: 0, uploadId: null, retryAt: null }))
    case "paused":
      return update(state, action.localId, STOPPABLE, () => ({ status: "paused", retryAt: null }))
    case "resumed":
      return update(state, action.localId, ["paused"], () => ({ status: "queued", error: null }))
    case "fileReattached":
      return update(state, action.localId, ["needsFile"], () => ({
        status: "queued",
        file: action.file,
        handle: action.handle,
        lastModified: action.file.lastModified,
        error: null,
        verifyHash: action.verifyHash,
        ...(action.keepSession ? {} : { sha256: null, uploadId: null, warnings: [] }),
      }))
    case "wrongFile":
      return update(state, action.localId, ["needsFile"], () => ({ error: action.error }))
    case "cancelled":
      return update(state, action.localId, ["conflict", "paused", "needsFile", ...STOPPABLE], () => ({ status: "cancelled", retryAt: null }))
    case "retried":
      // From "blocked" only for a version block (see versionBlocked): the release version may have changed
      return update(state, action.localId, ["failed", "cancelled", "blocked"], () => ({ status: "queued", loaded: 0, error: null, blockedBy: [] }))
    case "replaceRequested":
      return update(state, action.localId, ["conflict"], (item) => (item.holder?.fileId ? { status: "queued", loaded: 0, replaceFileId: item.holder.fileId, holder: null, uploadId: null } : {}))
    case "dismissed": {
      const items = state.items.filter((item) => item.localId !== action.localId || ACTIVE.includes(item.status))
      return items.length === state.items.length ? state : { ...state, items }
    }
    case "publishTracked": {
      const item: PublishItem = { releaseId: action.releaseId, releaseLabel: action.releaseLabel, job: action.job, interrupted: false }
      const existing = state.publishes.find((publish) => publish.releaseId === action.releaseId)
      return existing
        ? updatePublish(state, action.releaseId, (current) => ({ ...item, releaseLabel: action.releaseLabel || current.releaseLabel }))
        : { ...state, publishes: [...state.publishes, item] }
    }
    case "publishUpdated":
      return updatePublish(state, action.releaseId, (item) => ({ ...item, job: action.job, releaseLabel: action.releaseLabel || item.releaseLabel }))
    case "publishInterrupted":
      return updatePublish(state, action.releaseId, (item) => ({ ...item, job: null, interrupted: true }))
    case "publishDismissed":
      return updatePublish(state, action.releaseId, () => null)
    case "releaseForgotten": {
      const items = state.items.filter((item) => item.releaseId !== action.releaseId)
      const publishes = state.publishes.filter((item) => item.releaseId !== action.releaseId)
      return items.length === state.items.length && publishes.length === state.publishes.length ? state : { items, publishes }
    }
    case "reset":
      return emptyQueue
  }
}

// --- Selectors ---

const VERSION_REASONS = ["VERSION_MISMATCH", "VERSION_EXISTS"]

/**
 * Blocked only because its version isn't the release's. That verdict can
 * change once the release version does; identical bytes or damage can't.
 */
export function versionBlocked(item: Pick<QueueItem, "status" | "blockedBy">): boolean {
  return item.status === "blocked" && item.blockedBy.length > 0 && item.blockedBy.every((reason) => VERSION_REASONS.includes(reason.code))
}

/** One release's uploads, shaped like the whole state so the selectors below apply. */
export function forRelease(state: QueueState, releaseId: string): QueueState {
  return { items: state.items.filter((item) => item.releaseId === releaseId), publishes: [] }
}

/** Queued items that may start now, in drop order; the slots are shared by every release. */
export function nextToStart(state: QueueState, concurrency = 2): QueueItem[] {
  const active = state.items.filter((item) => ACTIVE.includes(item.status)).length
  const slots = Math.max(0, concurrency - active)
  return state.items.filter((item) => item.status === "queued").slice(0, slots)
}

/** "3 of 5 uploaded · 1.2 GB of 2.0 GB", size-weighted; cancelled, held and blocked files don't count. */
export function overall(state: QueueState) {
  const counted = state.items.filter((item) => !["cancelled", "conflict", "blocked"].includes(item.status))
  return {
    done: counted.filter((item) => item.status === "done").length,
    total: counted.length,
    loadedBytes: counted.reduce((sum, item) => sum + (item.status === "done" ? item.sizeBytes : item.loaded), 0),
    totalBytes: counted.reduce((sum, item) => sum + item.sizeBytes, 0),
  }
}

export const isBusy = (state: QueueState) => state.items.some((item) => item.status === "queued" || ACTIVE.includes(item.status))
export const hasFailures = (state: QueueState) => state.items.some((item) => item.status === "failed")
export const hasConflicts = (state: QueueState) => state.items.some((item) => item.status === "conflict")
/** Started but stopped: paused, or waiting for the file after a refresh. */
export const hasUnfinished = (state: QueueState) => state.items.some((item) => item.status === "paused" || item.status === "needsFile")
/**
 * Send for review waits until nothing is checking, uploading, paused, failed
 * or held on a platform conflict. Blocked files never joined the release, so
 * they don't.
 */
export const blocksSubmit = (state: QueueState) => isBusy(state) || hasFailures(state) || hasConflicts(state) || hasUnfinished(state)

/**
 * Another upload of the same release still in flight that claims `os`. Held
 * files claim nothing, and finished ones are saved files, judged by the
 * editor's current mapping.
 */
export function queueHolder(state: QueueState, releaseId: string, os: OperatingSystem, exceptId: string): PlatformHolder | null {
  const claimant = state.items.find(
    (item) => item.localId !== exceptId && item.releaseId === releaseId && item.kind === "sdk" && item.os === os && ["queued", "uploading", "finalizing", "waiting", "paused", "needsFile"].includes(item.status),
  )
  return claimant ? { fileId: null, name: claimant.name } : null
}
