import { ApiRequestError } from "@/lib/api/http"
import type { UploadOptions } from "@/lib/api/upload"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { ReleaseFileItem } from "@/pages/Releases/releases.model"
import { platformTakenBy } from "@/pages/Releases/releases.errors"
import { detectMapping } from "./detect-file"

// Framework-free upload queue for the release editor: a pure reducer plus a
// small runner that starts uploads (2 at a time), throttles progress and
// exposes subscribe/getSnapshot for useSyncExternalStore.
//
// Every dropped file uploads straight away, typed or not (an undetected file
// uploads unmapped and gets its type in the editor). The one exception is a
// file detected for a platform another file already has: it waits as a
// "conflict" until the uploader replaces that file or changes its mapping.

export type QueueStatus = "conflict" | "queued" | "uploading" | "finalizing" | "done" | "failed" | "cancelled"

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
  holder: PlatformHolder | null
  error: QueueError | null
  result: ReleaseFileItem | null
}

export type QueueState = { items: QueueItem[] }

export type QueueAction =
  | { type: "added"; items: { localId: string; file: File; kind: FileKind | null; os: OperatingSystem | null; holder: PlatformHolder | null }[] }
  | { type: "mapped"; localId: string; kind: FileKind | null; os: OperatingSystem | null; holder: PlatformHolder | null }
  | { type: "started"; localId: string }
  | { type: "progressed"; localId: string; loaded: number }
  | { type: "finalizing"; localId: string }
  | { type: "succeeded"; localId: string; file: ReleaseFileItem }
  | { type: "failed"; localId: string; error: QueueError }
  | { type: "conflicted"; localId: string; holder: PlatformHolder }
  | { type: "cancelled"; localId: string }
  | { type: "retried"; localId: string }
  | { type: "replaceRequested"; localId: string }
  | { type: "dismissed"; localId: string }

export const emptyQueue: QueueState = { items: [] }

const ACTIVE: QueueStatus[] = ["uploading", "finalizing"]

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
            holder,
            error: null,
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
      return update(state, action.localId, ["queued"], () => ({ status: "uploading", loaded: 0, error: null }))
    case "progressed":
      return update(state, action.localId, ["uploading"], (item) => ({ loaded: Math.min(action.loaded, item.sizeBytes) }))
    case "finalizing":
      return update(state, action.localId, ["uploading"], (item) => ({ status: "finalizing", loaded: item.sizeBytes }))
    case "succeeded":
      // Also from "cancelled": a cancel that lost the race still created the file
      return update(state, action.localId, ["uploading", "finalizing", "cancelled"], (item) => ({ status: "done", loaded: item.sizeBytes, result: action.file, error: null, holder: null }))
    case "failed":
      return update(state, action.localId, ACTIVE, () => ({ status: "failed", error: action.error }))
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

/** "3 of 5 uploaded · 1.2 GB of 2.0 GB", size-weighted; cancelled and held files don't count. */
export function overall(state: QueueState) {
  const counted = state.items.filter((item) => item.status !== "cancelled" && item.status !== "conflict")
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
/** Send for review waits until nothing is uploading, failed or held on a platform conflict. */
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

export type UploadRequest = { file: File; kind: FileKind | null; os: OperatingSystem | null; replace?: string }
export type UploadFn = (request: UploadRequest, options: UploadOptions) => Promise<ReleaseFileItem>

export type QueueHooks = {
  /** Called once per file the server accepted, so the page can refresh. */
  onUploaded?: (file: ReleaseFileItem) => void
  /** The saved file that has `os` in the editor's current mapping, if any. */
  savedHolder?: (os: OperatingSystem) => PlatformHolder | null
}

export type UploadQueueOptions = QueueHooks & {
  upload: UploadFn
  concurrency?: number
  progressIntervalMs?: number
  now?: () => number
  newId?: () => string
}

export type UploadQueue = ReturnType<typeof createUploadQueue>

function toQueueError(error: unknown): QueueError {
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message }
  return { code: "UNKNOWN", message: "The upload failed. Try again." }
}

export function createUploadQueue({ upload, concurrency = 2, progressIntervalMs = 100, now = Date.now, newId = () => crypto.randomUUID(), ...initialHooks }: UploadQueueOptions) {
  let state = emptyQueue
  let hooks: QueueHooks = initialHooks
  const listeners = new Set<() => void>()
  const controllers = new Map<string, AbortController>()

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

  const start = (item: QueueItem) => {
    const controller = new AbortController()
    controllers.set(item.localId, controller)
    dispatch({ type: "started", localId: item.localId })
    let lastProgress = 0

    const onProgress = (loaded: number, total: number) => {
      if (loaded >= total) {
        dispatch({ type: "finalizing", localId: item.localId })
      } else if (now() - lastProgress >= progressIntervalMs) {
        lastProgress = now()
        dispatch({ type: "progressed", localId: item.localId, loaded })
      }
    }

    const request: UploadRequest = { file: item.file, kind: item.kind, os: item.os, ...(item.replaceFileId && { replace: item.replaceFileId }) }
    upload(request, { onProgress, signal: controller.signal })
      .then((file) => {
        dispatch({ type: "succeeded", localId: item.localId, file })
        hooks.onUploaded?.(file)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const holderId = platformTakenBy(error)
        if (holderId) dispatch({ type: "conflicted", localId: item.localId, holder: { fileId: holderId, name: null } })
        else dispatch({ type: "failed", localId: item.localId, error: toQueueError(error) })
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
