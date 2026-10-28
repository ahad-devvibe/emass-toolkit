import type { UserRole } from "@/auth/auth.types"
import { ApiRequestError } from "@/lib/api/http"
import type { UploadOptions } from "@/lib/api/upload"
import type { HashFn } from "@/lib/hash/hash-file"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { detectMapping } from "@/pages/ReleaseEditor/detect-file"
import type { CheckRequest, FileVerdict } from "@/pages/ReleaseEditor/file-check"
import type { FileRange, UploadCreateInput, UploadSession } from "@/pages/Releases/releases.api"
import { fileBlockedReasons, platformTakenBy } from "@/pages/Releases/releases.errors"
import type { PublishJob, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { readIfGranted as readIfGrantedHandle, reopen as reopenHandle, sameFile, type FileHandle, type PickedFile } from "./file-source"
import { createPublishPoller, type PublishApi, type Schedule } from "./publish-poller"
import { memoryPersistence, type UploadPersistence, type UploadRecord } from "./upload-persistence"
import { emptyQueue, nextToStart, queueHolder, queueReducer, versionBlocked, type PlatformHolder, type QueueAction, type QueueError, type QueueItem, type QueueState } from "./uploads.state"

export type UploadsApi = PublishApi & {
  /** The server's verdict on a file before it uploads (see file-check.ts). */
  check: (releaseId: string, file: File, request: CheckRequest) => Promise<FileVerdict>
  create: (releaseId: string, input: UploadCreateInput) => Promise<UploadSession>
  putPart: (releaseId: string, uploadId: string, n: number, part: Blob, options: UploadOptions) => Promise<UploadSession>
  complete: (releaseId: string, uploadId: string) => Promise<ReleaseFileItem>
  abort: (releaseId: string, uploadId: string) => Promise<void>
  /** The release's saved file with these bytes, if any (after a lost response). */
  findUploaded: (releaseId: string, sha256: string) => Promise<ReleaseFileItem | null>
}

/** What the open editor of a release adds: its unsaved mapping, and a reload when a file lands. */
export type ReleaseHooks = {
  /** Called once per file the server accepted, so the page can refresh. */
  onUploaded?: (file: ReleaseFileItem) => void
  /** The saved file that has `os` in the editor's current mapping, if any. */
  savedHolder?: (os: OperatingSystem) => PlatformHolder | null
}

export type Connectivity = {
  isOnline: () => boolean
  /** Resolves once the browser is back online (or the signal aborts). */
  whenOnline: (signal: AbortSignal) => Promise<void>
}

export type UploadsStoreOptions = {
  api: UploadsApi
  /** The file's SHA-256, off the main thread (see lib/hash). */
  hash: HashFn
  persistence?: UploadPersistence
  connectivity?: Connectivity
  reopen?: (handle: FileHandle) => Promise<File>
  /** The file behind a handle without asking, or null when the browser would ask. */
  readIfGranted?: (handle: FileHandle) => Promise<File | null>
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  schedule?: Schedule
  /**
   * Waits before each lookup after a lost response: the server may still be
   * saving the file when the connection drops (it took 3 s in practice).
   */
  lookupWaitsMs?: number[]
  /** Between tries of a part that failed on the network; the last repeats. */
  retryDelaysMs?: number[]
  /**
   * Server errors in a row on one request before the upload fails with the
   * reason (a lost connection keeps waiting instead).
   */
  maxServerRetries?: number
  concurrency?: number
  progressIntervalMs?: number
  pollMs?: number
  now?: () => number
  newId?: () => string
}

export type UploadsStore = ReturnType<typeof createUploadsStore>

const cancelled = () => new ApiRequestError(0, "CANCELLED", "The upload was cancelled.")

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

export const browserConnectivity: Connectivity = {
  isOnline: () => typeof navigator === "undefined" || navigator.onLine,
  whenOnline: (signal) =>
    new Promise((resolve) => {
      const done = () => {
        window.removeEventListener("online", done)
        resolve()
      }
      window.addEventListener("online", done)
      signal.addEventListener("abort", done, { once: true })
    }),
}

const codeOf = (error: unknown) => (error instanceof ApiRequestError ? error.code : null)

/** The server answered, but with a failure: worth a few more tries, not forever. */
const serverError = (error: unknown) => error instanceof ApiRequestError && error.code !== "NETWORK_ERROR" && (error.code === "SERVER_UNAVAILABLE" || error.code === "TIMEOUT" || error.status >= 500)

/** The error an upload fails with once the server kept failing. */
const gaveUp = (error: unknown) =>
  new ApiRequestError(error instanceof ApiRequestError ? error.status : 0, "SERVER_KEEPS_FAILING", `The server couldn't store this file (${error instanceof ApiRequestError ? error.message : "unknown error"}). Retry to continue.`)

/** Worth trying again: the request may never have reached the server. */
const transient = (error: unknown) => error instanceof ApiRequestError && (error.code === "NETWORK_ERROR" || error.code === "SERVER_UNAVAILABLE" || error.code === "TIMEOUT" || error.status >= 500)

/**
 * A long upload can finish on the server and still lose its response (the
 * connection drops at the end), and a retry of it is then refused as the
 * same bytes. Either way the file may already be in the release.
 */
const lostResponse = (error: unknown) => codeOf(error) === "NETWORK_ERROR" || codeOf(error) === "SERVER_UNAVAILABLE"

function mayHaveLanded(error: unknown): boolean {
  if (lostResponse(error)) return true
  const reasons = fileBlockedReasons(error)
  return Boolean(reasons?.length) && reasons!.every((reason) => reason.code === "SAME_CONTENT")
}

function toQueueError(error: unknown): QueueError {
  if (codeOf(error) === "CHECKSUM_MISMATCH") return { code: "CHECKSUM_MISMATCH", message: "The file changed while uploading. Retry to check it again." }
  if (error instanceof ApiRequestError) return { code: error.code, message: error.message }
  return { code: "UNKNOWN", message: "The upload failed. Try again." }
}

const partExpected = (error: unknown) => (codeOf(error) === "PART_OUT_OF_ORDER" && typeof (error as ApiRequestError).details.expected === "number" ? ((error as ApiRequestError).details.expected as number) : null)

/**
 * Every release file being uploaded in this tab, and every publish job an
 * admin follows. Files go up piece by piece (2 at a time across releases):
 * check → hash → check again → open the server's session → parts in order →
 * complete. A network error retries the same piece; pausing keeps the pieces
 * already sent; after a refresh the upload waits for its file to be opened
 * again, then goes on where the server left off.
 */
export function createUploadsStore({
  api,
  hash,
  persistence = memoryPersistence(),
  connectivity = browserConnectivity,
  reopen = reopenHandle,
  readIfGranted = readIfGrantedHandle,
  sleep = abortableSleep,
  schedule,
  lookupWaitsMs = [0, 2000, 3000, 5000],
  retryDelaysMs = [1000, 2000, 5000, 10000, 30000],
  maxServerRetries = 6,
  concurrency = 3,
  progressIntervalMs = 100,
  pollMs,
  now = Date.now,
  newId = () => crypto.randomUUID(),
}: UploadsStoreOptions) {
  let state: QueueState = emptyQueue
  let userId: string | null = null
  const listeners = new Set<() => void>()
  const controllers = new Map<string, AbortController>()
  // The byte ranges each file's check has sent, reused by its next check
  const checkRanges = new Map<string, FileRange[]>()
  const releaseHooks = new Map<string, ReleaseHooks>()
  const publishListeners = new Map<string, Set<(job: PublishJob) => void>>()
  // Told about jobs whose release page isn't open (the panel's toast)
  const unwatchedListeners = new Set<(releaseId: string, job: PublishJob) => void>()
  // Uploads paused while their release is being deleted, resumed if that fails
  const heldForDelete = new Map<string, string[]>()

  const dispatch = (action: QueueAction) => {
    const next = queueReducer(state, action)
    if (next === state) return
    state = next
    for (const listener of listeners) listener()
  }

  const itemOf = (localId: string) => state.items.find((item) => item.localId === localId)

  const poller = createPublishPoller({
    api,
    getState: () => state,
    dispatch,
    schedule,
    pollMs,
    onSettled: (releaseId, job) => {
      const watching = publishListeners.get(releaseId)
      if (watching?.size) for (const listener of watching) listener(job)
      else for (const listener of unwatchedListeners) listener(releaseId, job)
    },
  })

  // --- Persistence: enough to resume after a refresh ---

  const persist = (localId: string) => {
    const item = itemOf(localId)
    if (!item || !userId) return
    const record: UploadRecord = {
      localId: item.localId,
      userId,
      releaseId: item.releaseId,
      releaseLabel: item.releaseLabel,
      name: item.name,
      sizeBytes: item.sizeBytes,
      lastModified: item.lastModified,
      sha256: item.sha256,
      uploadId: item.uploadId,
      kind: item.kind,
      os: item.os,
      replaceFileId: item.replaceFileId,
      warnings: item.warnings,
      handle: item.handle,
    }
    void persistence.put(record).catch(() => undefined)
  }
  const forget = (localId: string) => void persistence.remove(localId).catch(() => undefined)

  // A saved file wins over another upload, since only it can be replaced
  const holderFor = (releaseId: string, kind: FileKind | null, os: OperatingSystem | null, localId: string): PlatformHolder | null => {
    if (kind !== "sdk" || !os) return null
    return releaseHooks.get(releaseId)?.savedHolder?.(os) ?? queueHolder(state, releaseId, os, localId)
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

  /** Waits out a network problem: until back online, or the next retry delay. */
  const backOff = async (localId: string, attempt: number, signal: AbortSignal, error: unknown) => {
    const offline = !connectivity.isOnline()
    const delay = retryDelaysMs[Math.min(attempt, retryDelaysMs.length - 1)]
    const kind = offline ? "offline" : codeOf(error) === "NETWORK_ERROR" ? "network" : "server"
    const message = error instanceof ApiRequestError ? error.message : "Something went wrong"
    console.warn(`[uploads] ${itemOf(localId)?.name ?? localId}: attempt ${attempt + 1} failed`, error)
    dispatch({ type: "waiting", localId, retryAt: offline ? null : now() + delay, reason: { kind, message, attempt: attempt + 1 } })
    if (offline) await connectivity.whenOnline(signal)
    else await sleep(delay, signal)
    if (signal.aborted) throw cancelled()
    dispatch({ type: "reconnected", localId })
  }

  /**
   * One more try after a temporary failure? A lost connection always waits
   * (that's what resuming is for); server errors stop after maxServerRetries
   * in a row, so a lasting fault fails with its reason instead of looping.
   */
  const keepTrying = (error: unknown, serverFailures: number) => !(serverError(error) && serverFailures >= maxServerRetries)

  /** Runs `call` until it succeeds, fails for good, or the server keeps failing. */
  const withRetry = async <T>(localId: string, signal: AbortSignal, call: () => Promise<T>): Promise<T> => {
    let serverFailures = 0
    for (let attempt = 0; ; attempt++) {
      try {
        return await call()
      } catch (error) {
        if (signal.aborted || !transient(error)) throw error
        if (serverError(error)) serverFailures++
        if (!keepTrying(error, serverFailures)) throw gaveUp(error)
        await backOff(localId, attempt, signal, error)
      }
    }
  }

  /** Looks for the file among the release's saved files, after each wait. */
  const lookup = async (releaseId: string, sha256: string, waits: number[], signal: AbortSignal) => {
    for (const wait of waits) {
      if (wait > 0) await sleep(wait, signal)
      if (signal.aborted) return null
      const saved = await api.findUploaded(releaseId, sha256).catch(() => null)
      if (signal.aborted) return null
      if (saved) return saved
    }
    return null
  }

  /**
   * Complete can lose its response, or meet another complete of the same
   * upload: in both cases the file may be saved already, so look first.
   */
  const completeWithRecovery = async (item: QueueItem, uploadId: string, sha256: string, signal: AbortSignal) => {
    let serverFailures = 0
    for (let attempt = 0; ; attempt++) {
      try {
        return await api.complete(item.releaseId, uploadId)
      } catch (error) {
        if (signal.aborted) throw error
        const code = codeOf(error)
        if (!transient(error) && code !== "UPLOAD_COMPLETING" && code !== "UPLOAD_NOT_FOUND") throw error
        const saved = await lookup(item.releaseId, sha256, code === "UPLOAD_NOT_FOUND" ? [0] : lookupWaitsMs, signal)
        if (saved) return saved
        if (code === "UPLOAD_NOT_FOUND") throw error
        if (serverError(error)) serverFailures++
        if (!keepTrying(error, serverFailures)) throw gaveUp(error)
        await backOff(item.localId, attempt, signal, error)
      }
    }
  }

  // check versions → hash → check content → session → parts → complete
  // `attempt.sha256` is set once known, so a failure can look the file up
  const pipeline = async (item: QueueItem, file: File, signal: AbortSignal, attempt: { sha256: string | null }) => {
    const { localId, releaseId } = item
    const ranges = checkRanges.get(localId) ?? []
    checkRanges.set(localId, ranges)
    const replace = item.replaceFileId ?? undefined
    let sha256 = item.sha256
    let uploadId = item.uploadId

    if (!sha256 || item.verifyHash) {
      let warnings = item.warnings
      if (!sha256) {
        warnings = (await api.check(releaseId, file, { replace, ranges })).warnings
        if (signal.aborted) return
      }
      dispatch({ type: "hashing", localId, warnings })
      const hashed = await hash(file, { signal, onProgress: throttled((bytes) => dispatch({ type: "hashProgressed", localId, hashed: bytes }), file.size) })
      // A file picked again after a refresh that isn't the same bytes starts over
      if (sha256 && hashed !== sha256 && uploadId) {
        void api.abort(releaseId, uploadId).catch(() => undefined)
        uploadId = null
      }
      sha256 = hashed
      dispatch({ type: "hashed", localId, sha256 })
      persist(localId)
    }
    attempt.sha256 = sha256

    // A session already open was checked before; complete judges it again anyway
    if (uploadId) {
      dispatch({ type: "allowed", localId, warnings: item.warnings })
    } else {
      const verdict = await api.check(releaseId, file, { replace, ranges, sha256 })
      if (signal.aborted) return
      dispatch({ type: "allowed", localId, warnings: verdict.warnings })
    }

    const open = async () => {
      const opened = await withRetry(localId, signal, () => api.create(releaseId, { name: file.name, size: file.size, sha256: sha256!, contentType: file.type || undefined, kind: item.kind, os: item.os, replace }))
      dispatch({ type: "sessionOpened", localId, uploadId: opened.uploadId, loaded: opened.partsDone * opened.partSize })
      persist(localId)
      return opened
    }
    // Opening again returns the existing session, with the parts it already has
    let session = await open()
    const parts = Math.max(1, Math.ceil(file.size / session.partSize))
    const progress = throttled((loaded) => dispatch({ type: "progressed", localId, loaded }), file.size)
    let reopened = false
    let n = session.partsDone + 1

    while (n <= parts) {
      const start = (n - 1) * session.partSize
      const part = file.slice(start, start + session.partSize)
      try {
        const stored = await withRetry(localId, signal, () => api.putPart(releaseId, session.uploadId, n, part, { signal, onProgress: (loaded) => progress(start + loaded) }))
        n = stored.partsDone + 1
      } catch (error) {
        if (signal.aborted) throw error
        const expected = partExpected(error)
        if (expected !== null) {
          n = expected
          continue
        }
        // The session expired or was cancelled elsewhere: open a new one, once
        if (codeOf(error) === "UPLOAD_NOT_FOUND" && !reopened) {
          reopened = true
          dispatch({ type: "sessionLost", localId })
          session = await open()
          n = session.partsDone + 1
          continue
        }
        throw error
      }
    }

    dispatch({ type: "finalizing", localId })
    const saved = await completeWithRecovery(item, session.uploadId, sha256, signal)
    checkRanges.delete(localId)
    dispatch({ type: "succeeded", localId, file: saved })
    forget(localId)
    releaseHooks.get(releaseId)?.onUploaded?.(saved)
  }

  const start = (item: QueueItem) => {
    const file = item.file
    if (!file) return
    const controller = new AbortController()
    controllers.set(item.localId, controller)
    dispatch({ type: "started", localId: item.localId })

    const attempt = { sha256: item.sha256 }
    pipeline(item, file, controller.signal, attempt)
      .catch(async (error: unknown) => {
        if (controller.signal.aborted) return
        if (attempt.sha256 && mayHaveLanded(error)) {
          // A refused retry means the bytes are saved now: one look is enough
          const saved = await lookup(item.releaseId, attempt.sha256, lostResponse(error) ? lookupWaitsMs : [0], controller.signal)
          if (controller.signal.aborted) return
          if (saved) {
            dispatch({ type: "succeeded", localId: item.localId, file: saved })
            forget(item.localId)
            releaseHooks.get(item.releaseId)?.onUploaded?.(saved)
            return
          }
        }
        const reasons = fileBlockedReasons(error)
        const holderId = platformTakenBy(error)
        if (reasons) {
          dispatch({ type: "blocked", localId: item.localId, reasons })
          forget(item.localId)
        } else if (holderId) {
          dispatch({ type: "conflicted", localId: item.localId, holder: { fileId: holderId, name: null } })
          persist(item.localId)
        } else {
          dispatch({ type: "failed", localId: item.localId, error: toQueueError(error), forgetHash: codeOf(error) === "CHECKSUM_MISMATCH" })
          persist(item.localId)
        }
      })
      .finally(() => {
        if (controllers.get(item.localId) === controller) controllers.delete(item.localId)
        pump()
      })
  }

  const pump = () => {
    for (const item of nextToStart(state, concurrency)) start(item)
  }

  const act = (action: QueueAction, persistId?: string) => {
    dispatch(action)
    if (persistId) persist(persistId)
    pump()
  }

  /** Stops the item's running step, if any. */
  const halt = (localId: string) => {
    controllers.get(localId)?.abort()
    controllers.delete(localId)
  }

  /** Cancels the server's session too, so its parts don't wait 24 h. */
  const discard = (item: QueueItem | undefined) => {
    if (item?.uploadId && item.status !== "done") void api.abort(item.releaseId, item.uploadId).catch(() => undefined)
  }

  /** Back on its file after a refresh: same file → same session; changed → it starts over. */
  const reattach = (item: QueueItem, file: File, handle: FileHandle) => {
    const same = sameFile(file, item)
    // Changed on disk since: what was sent so far is no use
    if (!same) discard(item)
    dispatch({ type: "fileReattached", localId: item.localId, file, handle, keepSession: same, verifyHash: false })
    persist(item.localId)
  }

  const waitingForFile = () => state.items.filter((item) => item.status === "needsFile")

  /** After a refresh: carry on by itself wherever the browser still lets us read the file. */
  const resumeGranted = async () => {
    for (const item of waitingForFile()) {
      if (!item.handle) continue
      const file = await readIfGranted(item.handle)
      if (file && itemOf(item.localId)?.status === "needsFile") reattach(item, file, item.handle)
    }
    pump()
  }

  const reopenOne = async (item: QueueItem) => {
    try {
      reattach(item, await reopen(item.handle!), item.handle!)
    } catch {
      dispatch({ type: "wrongFile", localId: item.localId, error: { code: "FILE_UNAVAILABLE", message: `Couldn't open ${item.name} again. Pick it to resume.` } })
    }
  }

  const pickedAgain = (item: QueueItem, file: File, handle: FileHandle | null) => {
    if (file.name !== item.name || file.size !== item.sizeBytes) {
      dispatch({ type: "wrongFile", localId: item.localId, error: { code: "WRONG_FILE", message: `That's a different file. Pick ${item.name} to resume.` } })
      return
    }
    dispatch({ type: "fileReattached", localId: item.localId, file, handle: handle ?? item.handle, keepSession: true, verifyHash: true })
    persist(item.localId)
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /**
     * Who is signed in. A DEV's unfinished uploads come back from the last
     * visit (each waiting for its file); an admin's running publish jobs are
     * picked up. Someone else's records are deleted.
     */
    async start(user: { id: string; role: UserRole }) {
      if (userId === user.id) return
      userId = user.id
      if (user.role === "DEV") {
        const records = await persistence.load(user.id).catch(() => [])
        if (userId !== user.id) return
        // A record holds everything a restored item needs (and its owner, unused)
        dispatch({ type: "restored", items: records })
        await resumeGranted()
      }
      if (user.role === "ADMIN") await poller.seed()
    },
    /** Signed out: stop everything and forget it, so the next person sees nothing. */
    stop() {
      userId = null
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      checkRanges.clear()
      poller.stop()
      dispatch({ type: "reset" })
      void persistence.clear().catch(() => undefined)
    },

    /** The open editor's view of its release; returns the unregister call. */
    registerRelease(releaseId: string, hooks: ReleaseHooks) {
      releaseHooks.set(releaseId, hooks)
      return () => {
        if (releaseHooks.get(releaseId) === hooks) releaseHooks.delete(releaseId)
      }
    },

    add(releaseId: string, releaseLabel: string, picked: PickedFile[]) {
      // One at a time, so two dropped Windows builds conflict with each other too
      for (const { file, handle } of picked) {
        const localId = newId()
        const { kind, os = null } = detectMapping(file.name)
        dispatch({ type: "added", items: [{ localId, releaseId, releaseLabel, file, handle, kind, os, holder: holderFor(releaseId, kind, os, localId) }] })
        persist(localId)
      }
      pump()
    },
    /** Change a held (or failed) file's mapping; it uploads if nothing else has the platform. */
    map(localId: string, kind: FileKind | null, os: OperatingSystem | null) {
      const item = itemOf(localId)
      if (!item) return
      discard(item)
      act({ type: "mapped", localId, kind, os, holder: holderFor(item.releaseId, kind, os, localId) }, localId)
    },
    retry(localId: string) {
      const item = itemOf(localId)
      if (!item?.file) return
      // A block only goes back for another check when the version was the reason
      if (item.status === "blocked" && !versionBlocked(item)) return
      act({ type: "retried", localId })
    },
    /** The release version changed: check its version-blocked files again (no re-hashing). */
    recheckRelease(releaseId: string) {
      for (const item of state.items) {
        if (item.releaseId === releaseId && item.file && versionBlocked(item)) dispatch({ type: "retried", localId: item.localId })
      }
      pump()
    },
    /** Upload the held file in place of the saved file that has its platform. */
    replace: (localId: string) => act({ type: "replaceRequested", localId }, localId),
    pause(localId: string) {
      dispatch({ type: "paused", localId })
      halt(localId)
      pump()
    },
    resume: (localId: string) => act({ type: "resumed", localId }),
    cancel(localId: string) {
      const item = itemOf(localId)
      dispatch({ type: "cancelled", localId })
      halt(localId)
      discard(item)
      forget(localId)
      pump()
    },
    dismiss(localId: string) {
      const item = itemOf(localId)
      dispatch({ type: "cancelled", localId })
      halt(localId)
      discard(item)
      checkRanges.delete(localId)
      forget(localId)
      act({ type: "dismissed", localId })
    },

    /**
     * Before deleting a release: pause its running uploads, so no part is
     * sent to a session the delete is about to cancel.
     */
    pauseRelease(releaseId: string) {
      const moving = state.items.filter((item) => item.releaseId === releaseId && ["queued", "checking", "hashing", "uploading", "finalizing", "waiting"].includes(item.status))
      for (const item of moving) {
        dispatch({ type: "paused", localId: item.localId })
        halt(item.localId)
      }
      heldForDelete.set(releaseId, moving.map((item) => item.localId))
      pump()
    },
    /** The delete failed: carry on with what pauseRelease stopped. */
    resumeRelease(releaseId: string) {
      for (const localId of heldForDelete.get(releaseId) ?? []) dispatch({ type: "resumed", localId })
      heldForDelete.delete(releaseId)
      pump()
    },
    /** The release is gone: drop its uploads (the server cancelled their sessions with it). */
    forgetRelease(releaseId: string) {
      for (const item of state.items.filter((candidate) => candidate.releaseId === releaseId)) {
        halt(item.localId)
        checkRanges.delete(item.localId)
        forget(item.localId)
      }
      heldForDelete.delete(releaseId)
      dispatch({ type: "releaseForgotten", releaseId })
      pump()
    },

    /**
     * After a refresh, with the handle kept from the drop (Chrome, Edge).
     * Call it from a click: reading the file again needs the user's permission.
     */
    async resumeWithHandle(localId: string) {
      const item = itemOf(localId)
      if (!item?.handle || item.status !== "needsFile") return
      await reopenOne(item)
      pump()
    },
    /** After a refresh, with the file picked again: it must be the same one, which hashing confirms. */
    resumeWithFile(localId: string, file: File, handle: FileHandle | null = null) {
      const item = itemOf(localId)
      if (!item || item.status !== "needsFile") return
      pickedAgain(item, file, handle)
      pump()
    },
    /**
     * "Resume all": reopen every interrupted upload that kept a handle, one
     * after another. Call it from a click (reading the files may ask first).
     */
    async resumeAll(releaseId?: string) {
      for (const item of waitingForFile()) {
        if (item.handle && (!releaseId || item.releaseId === releaseId)) await reopenOne(item)
      }
      pump()
    },
    /**
     * "Pick files": the interrupted uploads picked again in one go, matched by
     * name and size. Returns the names that matched none of them.
     */
    resumeWithFiles(picked: PickedFile[], releaseId?: string): string[] {
      const open = waitingForFile().filter((item) => !releaseId || item.releaseId === releaseId)
      const unmatched: string[] = []
      for (const { file, handle } of picked) {
        const at = open.findIndex((item) => item.name === file.name && item.sizeBytes === file.size)
        if (at < 0) {
          unmatched.push(file.name)
          continue
        }
        pickedAgain(open[at], file, handle)
        open.splice(at, 1)
      }
      pump()
      return unmatched
    },
    /** "Cancel all" for the uploads a refresh interrupted. */
    cancelInterrupted(releaseId?: string) {
      for (const item of waitingForFile()) {
        if (releaseId && item.releaseId !== releaseId) continue
        dispatch({ type: "cancelled", localId: item.localId })
        discard(item)
        forget(item.localId)
      }
      pump()
    },

    /** Follow a publish job started from this tab. */
    trackPublish: (releaseId: string, releaseLabel: string, job: PublishJob | null) => poller.track(releaseId, releaseLabel, job),
    dismissPublish: (releaseId: string) => dispatch({ type: "publishDismissed", releaseId }),
    /** Called once when a job settles while no page watches its release. */
    onUnwatchedPublishSettled(listener: (releaseId: string, job: PublishJob) => void) {
      unwatchedListeners.add(listener)
      return () => {
        unwatchedListeners.delete(listener)
      }
    },
    /** Called once when the release's publish job settles (done or failed). */
    onPublishSettled(releaseId: string, listener: (job: PublishJob) => void) {
      const set = publishListeners.get(releaseId) ?? new Set()
      set.add(listener)
      publishListeners.set(releaseId, set)
      return () => {
        set.delete(listener)
        if (set.size === 0) publishListeners.delete(releaseId)
      }
    },
  }
}
