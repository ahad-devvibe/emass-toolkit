import { ApiRequestError } from "@/lib/api/http"
import type { UploadOptions } from "@/lib/api/upload"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { HashFn } from "@/lib/hash/hash-file"
import type { FileRange } from "@/pages/Releases/releases.api"
import type { FileIssue, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { fileBlockedReasons, platformTakenBy } from "@/pages/Releases/releases.errors"
import { detectMapping } from "./detect-file"
import type { CheckFn } from "./file-check"

// Framework-free upload queue for the release editor: a pure reducer plus a
// small runner that starts uploads (2 at a time), throttles progress and
// exposes subscribe/getSnapshot for useSyncExternalStore.
//
// Every dropped file is checked, then uploads, typed or not (an undetected
// file uploads unmapped and gets its type in the editor). Checking asks the
// server to rule on the file's versions, hashes it in a worker, then asks
// again with the hash: a blocked file never uploads. A file detected for a
// platform another file already has waits as a "conflict" first, until the
// uploader replaces that file or changes its mapping.

export type QueueStatus = "conflict" | "queued" | "checking" | "hashing" | "uploading" | "finalizing" | "done" | "failed" | "cancelled" | "blocked"

export type QueueError = { code: string; message: string }

/** Who already has the platform: a saved file (with id) or another upload in this queue. */
export type PlatformHolder = { fileId: string | null; name: string | null }

export type QueueItem = {
  localId: string
  file: File
  name: string
  sizeBytes: number
  kind: FileKind | null
  os: OperatingSystem | null
  replaceFileId: string | null
  status: QueueStatus
  loaded: number
  /** Bytes hashed so far, while hashing. */
  hashed: number
  /** Known once hashed; kept for a retry unless the server saw other bytes. */
  sha256: string | null
  holder: PlatformHolder | null
  error: QueueError | null
  /** Why the server refuses the file (status "blocked"). */
  blockedBy: FileIssue[]
  /** What the check said to look at; the file still uploads. */
  warnings: FileIssue[]
  result: ReleaseFileItem | null
}

export type QueueState = { items: QueueItem[] }

export type QueueAction =
  | { type: "added"; items: { localId: string; file: File; kind: FileKind | null; os: OperatingSystem | null; holder: PlatformHolder | null }[] }
  | { type: "mapped"; localId: string; kind: FileKind | null; os: OperatingSystem | null; holder: PlatformHolder | null }
  | { type: "started"; localId: string }
  | { type: "hashing"; localId: string; warnings: FileIssue[] }
  | { type: "hashProgressed"; localId: string; hashed: number }
  | { type: "hashed"; localId: string; sha256: string }
  | { type: "allowed"; localId: string; warnings: FileIssue[] }
  | { type: "blocked"; localId: string; reasons: FileIssue[] }
  | { type: "progressed"; localId: string; loaded: number }
  | { type: "finalizing"; localId: string }
  | { type: "succeeded"; localId: string; file: ReleaseFileItem }
  | { type: "failed"; localId: string; error: QueueError; forgetHash?: boolean }
  | { type: "conflicted"; localId: string; holder: PlatformHolder }
  | { type: "cancelled"; localId: string }
  | { type: "retried"; localId: string }
  | { type: "replaceRequested"; localId: string }
  | { type: "dismissed"; localId: string }

export const emptyQueue: QueueState = { items: [] }

const ACTIVE: QueueStatus[] = ["checking", "hashing", "uploading", "finalizing"]

// Docs never carry a platform; an SDK without one is fine (chosen later)
const normalize = (kind: FileKind | null, os: OperatingSystem | null) => ({ kind, os: kind === "sdk" ? os : null })

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
  return changed ? { items } : state
}

export function queueReducer(state: QueueState, action: QueueAction): QueueState {
  switch (action.type) {
    case "added":
      return {
        items: [
          ...state.items,
          ...action.items.map(({ localId, file, kind, os, holder }) => ({
            localId,
            file,
            name: file.name,
            sizeBytes: file.size,
            ...normalize(kind, os),
            replaceFileId: null,
            status: holder ? ("conflict" as const) : ("queued" as const),
            loaded: 0,
            hashed: 0,
            sha256: null,
            holder,
            error: null,
            blockedBy: [],
            warnings: [],
            result: null,
          })),
        ],
      }
    case "mapped":
      return update(state, action.localId, ["conflict", "failed"], () => ({
        ...normalize(action.kind, action.os),
        status: action.holder ? "conflict" : "queued",
        holder: action.holder,
        replaceFileId: null,
        loaded: 0,
        error: null,
      }))
    case "started":
      return update(state, action.localId, ["queued"], () => ({ status: "checking", loaded: 0, error: null }))
    case "hashing":
      return update(state, action.localId, ["checking"], () => ({ status: "hashing", hashed: 0, warnings: action.warnings }))
    case "hashProgressed":
      return update(state, action.localId, ["hashing"], (item) => ({ hashed: Math.min(action.hashed, item.sizeBytes) }))
    case "hashed":
      return update(state, action.localId, ["hashing"], () => ({ status: "checking", sha256: action.sha256 }))
    case "allowed":
      return update(state, action.localId, ["checking"], () => ({ status: "uploading", loaded: 0, warnings: action.warnings }))
    case "blocked":
      return update(state, action.localId, ACTIVE, () => ({ status: "blocked", blockedBy: action.reasons }))
    case "progressed":
      return update(state, action.localId, ["uploading"], (item) => ({ loaded: Math.min(action.loaded, item.sizeBytes) }))
    case "finalizing":
      return update(state, action.localId, ["uploading"], (item) => ({ status: "finalizing", loaded: item.sizeBytes }))
    case "succeeded":
      // Also from "cancelled" (a cancel that lost the race still created the
      // file) and "checking" (a retry found the earlier attempt had landed)
      return update(state, action.localId, [...ACTIVE, "cancelled"], (item) => ({ status: "done", loaded: item.sizeBytes, result: action.file, error: null, holder: null }))
    case "failed":
      return update(state, action.localId, ACTIVE, (item) => ({ status: "failed", error: action.error, sha256: action.forgetHash ? null : item.sha256 }))
    case "conflicted":
      // The server's backstop: another upload took the platform first
      return update(state, action.localId, ACTIVE, () => ({ status: "conflict", holder: action.holder, loaded: 0 }))
    case "cancelled":
      return update(state, action.localId, ["conflict", "queued", ...ACTIVE], () => ({ status: "cancelled" }))
    case "retried":
      return update(state, action.localId, ["failed", "cancelled"], () => ({ status: "queued", loaded: 0, error: null }))
    case "replaceRequested":
      return update(state, action.localId, ["conflict"], (item) => (item.holder?.fileId ? { status: "queued", loaded: 0, replaceFileId: item.holder.fileId, holder: null } : {}))
    case "dismissed": {
      const items = state.items.filter((item) => item.localId !== action.localId || ACTIVE.includes(item.status))
      return items.length === state.items.length ? state : { items }
    }
  }
}

// --- Selectors ---

/** Queued items that may start now, in drop order. */
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
/**
 * Send for review waits until nothing is checking, uploading, failed or held
 * on a platform conflict. Blocked files never joined the release, so they don't.
 */
export const blocksSubmit = (state: QueueState) => isBusy(state) || hasFailures(state) || hasConflicts(state)

/**
 * Another upload still in flight that claims `os`. Held files claim nothing,
 * and finished ones are saved files, judged by the editor's current mapping.
 */
function queueHolder(state: QueueState, os: OperatingSystem, exceptId: string): PlatformHolder | null {
  const claimant = state.items.find((item) => item.localId !== exceptId && item.kind === "sdk" && item.os === os && ["queued", "uploading", "finalizing"].includes(item.status))
  return claimant ? { fileId: null, name: claimant.name } : null
}

// --- Runner ---

export type UploadRequest = { file: File; kind: FileKind | null; os: OperatingSystem | null; replace?: string; sha256: string }
export type UploadFn = (request: UploadRequest, options: UploadOptions) => Promise<ReleaseFileItem>

export type QueueHooks = {
  /** Called once per file the server accepted, so the page can refresh. */
  onUploaded?: (file: ReleaseFileItem) => void
  /** The saved file that has `os` in the editor's current mapping, if any. */
  savedHolder?: (os: OperatingSystem) => PlatformHolder | null
}

export type UploadQueueOptions = QueueHooks & {
  upload: UploadFn
  /** The server's verdict on a file before it uploads (see file-check.ts). */
  check: CheckFn
  /** The file's SHA-256, off the main thread (see lib/hash). */
  hash: HashFn
  /**
   * The release's saved file with these bytes, if any. Asked when an upload
   * may have landed without its response reaching us (see `mayHaveLanded`).
   */
  findUploaded?: (sha256: string) => Promise<ReleaseFileItem | null>
  /**
   * Waits before each lookup after a lost response: the server may still be
   * saving the file when the connection drops (it took 3 s in practice).
   */
  lookupWaitsMs?: number[]
  sleep?: (ms: number) => Promise<void>
  concurrency?: number
  progressIntervalMs?: number
  now?: () => number
  newId?: () => string
}

export type UploadQueue = ReturnType<typeof createUploadQueue>

/**
 * A long upload can finish on the server and still lose its response (the
 * connection drops at the end), and a retry of it is then refused as the
 * same bytes. Either way the file may already be in the release.
 */
const lostResponse = (error: unknown) => error instanceof ApiRequestError && (error.code === "NETWORK_ERROR" || error.code === "SERVER_UNAVAILABLE")

function mayHaveLanded(error: unknown): boolean {
  if (lostResponse(error)) return true
  const reasons = fileBlockedReasons(error)
  return Boolean(reasons?.length) && reasons!.every((reason) => reason.code === "SAME_CONTENT")
}

function toQueueError(error: unknown): QueueError {
  if (error instanceof ApiRequestError && error.code === "CHECKSUM_MISMATCH") return { code: error.code, message: "The file changed while uploading. Retry to check it again." }
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message }
  return { code: "UNKNOWN", message: "The upload failed. Try again." }
}

export function createUploadQueue({ upload, check, hash, findUploaded, lookupWaitsMs = [0, 2000, 3000, 5000], sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), concurrency = 2, progressIntervalMs = 100, now = Date.now, newId = () => crypto.randomUUID(), ...initialHooks }: UploadQueueOptions) {
  let state = emptyQueue
  let hooks: QueueHooks = initialHooks
  const listeners = new Set<() => void>()
  const controllers = new Map<string, AbortController>()
  // The byte ranges each file's check has sent, reused by its next check
  const checkRanges = new Map<string, FileRange[]>()

  const dispatch = (action: QueueAction) => {
    const next = queueReducer(state, action)
    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }

  // A saved file wins over another upload, since only it can be replaced
  const holderFor = (kind: FileKind | null, os: OperatingSystem | null, localId: string): PlatformHolder | null => {
    if (kind !== "sdk" || !os) return null
    return hooks.savedHolder?.(os) ?? queueHolder(state, os, localId)
  }

  /** Calls `report` at most every progressIntervalMs, and always for the final value. */
  const throttled = (report: (value: number) => void, final: number) => {
    let last = 0
    return (value: number) => {
      if (value < final && now() - last < progressIntervalMs) return
      last = now()
      report(value)
    }
  }

  // check versions → hash → check content → upload; any block stops it there
  // `attempt.sha256` is set once known, so a failure can look the file up
  const pipeline = async (item: QueueItem, signal: AbortSignal, attempt: { sha256: string | null }) => {
    const { localId, file } = item
    const ranges = checkRanges.get(localId) ?? []
    checkRanges.set(localId, ranges)
    const replace = item.replaceFileId ?? undefined
    let sha256 = item.sha256
    if (!sha256) {
      const versions = await check(file, { replace, ranges })
      if (signal.aborted) return
      dispatch({ type: "hashing", localId, warnings: versions.warnings })
      sha256 = await hash(file, { signal, onProgress: throttled((hashed) => dispatch({ type: "hashProgressed", localId, hashed }), file.size) })
      dispatch({ type: "hashed", localId, sha256 })
    }
    attempt.sha256 = sha256
    const verdict = await check(file, { replace, ranges, sha256 })
    if (signal.aborted) return
    dispatch({ type: "allowed", localId, warnings: verdict.warnings })

    const progress = throttled((loaded) => dispatch({ type: "progressed", localId, loaded }), file.size)
    const onProgress = (loaded: number, total: number) => {
      if (loaded >= total) dispatch({ type: "finalizing", localId })
      else progress(loaded)
    }
    const uploaded = await upload({ file, kind: item.kind, os: item.os, sha256, ...(replace && { replace }) }, { onProgress, signal })
    checkRanges.delete(localId)
    dispatch({ type: "succeeded", localId, file: uploaded })
    hooks.onUploaded?.(uploaded)
  }

  const start = (item: QueueItem) => {
    const controller = new AbortController()
    controllers.set(item.localId, controller)
    dispatch({ type: "started", localId: item.localId })

    const attempt = { sha256: item.sha256 }
    pipeline(item, controller.signal, attempt)
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        if (attempt.sha256 && findUploaded && mayHaveLanded(error)) {
          // A refused retry means the bytes are saved now: one look is enough
          for (const wait of lostResponse(error) ? lookupWaitsMs : [0]) {
            if (wait > 0) await sleep(wait)
            if (controller.signal.aborted) return
            const saved = await findUploaded(attempt.sha256).catch(() => null)
            if (controller.signal.aborted) return
            if (saved) {
              dispatch({ type: "succeeded", localId: item.localId, file: saved })
              hooks.onUploaded?.(saved)
              return
            }
          }
        }
        const reasons = fileBlockedReasons(error)
        const holderId = platformTakenBy(error)
        if (reasons) dispatch({ type: "blocked", localId: item.localId, reasons })
        else if (holderId) dispatch({ type: "conflicted", localId: item.localId, holder: { fileId: holderId, name: null } })
        else dispatch({ type: "failed", localId: item.localId, error: toQueueError(error), forgetHash: error instanceof ApiRequestError && error.code === "CHECKSUM_MISMATCH" })
      })
      .finally(() => {
        controllers.delete(item.localId)
        pump()
      })
  }

  const pump = () => {
    for (const item of nextToStart(state, concurrency)) start(item)
  }

  const act = (action: QueueAction) => {
    dispatch(action)
    pump()
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    /** Swap the page's callbacks (its latest handlers). */
    configure: (next: QueueHooks) => {
      hooks = next
    },
    add: (files: File[]) => {
      // One at a time, so two dropped Windows builds conflict with each other too
      for (const file of files) {
        const localId = newId()
        const { kind, os = null } = detectMapping(file.name)
        dispatch({ type: "added", items: [{ localId, file, kind, os, holder: holderFor(kind, os, localId) }] })
      }
      pump()
    },
    /** Change a held (or failed) file's mapping; it uploads if nothing else has the platform. */
    map: (localId: string, kind: FileKind | null, os: OperatingSystem | null) => act({ type: "mapped", localId, kind, os, holder: holderFor(kind, os, localId) }),
    retry: (localId: string) => act({ type: "retried", localId }),
    /** Upload the held file in place of the saved file that has its platform. */
    replace: (localId: string) => act({ type: "replaceRequested", localId }),
    cancel: (localId: string) => {
      dispatch({ type: "cancelled", localId })
      controllers.get(localId)?.abort()
      pump()
    },
    dismiss: (localId: string) => {
      dispatch({ type: "cancelled", localId })
      controllers.get(localId)?.abort()
      checkRanges.delete(localId)
      act({ type: "dismissed", localId })
    },
    /** Aborts every running upload (e.g. on unmount). */
    dispose: () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      listeners.clear()
    },
  }
}
