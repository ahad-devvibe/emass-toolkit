import { apiRequest, ApiRequestError, type RequestOptions } from "@/lib/api/http"
import { uploadCancelled, uploadMultipart, type UploadOptions } from "@/lib/api/upload"

/*
 * Session + refresh coordination.
 *
 * Both tokens are httpOnly cookies set by the server: the access cookie
 * (15 min, sent to every /api route) and the refresh cookie (rotated on every
 * /auth/refresh). JS never reads either; when a request comes back 401 because
 * the access cookie expired, we refresh once and retry.
 *
 * Two refreshes carrying the same refresh cookie make the server treat the
 * second as token reuse and revoke every session the user has, so this module
 * guarantees one /refresh in flight per device:
 *   - within a tab, callers share one pending promise;
 *   - across tabs, the refresh runs under a device-wide lock (Web Locks, or a
 *     localStorage lease where Web Locks are unavailable, e.g. plain-http LAN);
 *   - a tab that waited on the lock while another tab refreshed reuses that
 *     result instead of calling /refresh again (the cookies are shared).
 */

export type SessionEvent = { type: "active"; fromOtherTab: boolean } | { type: "signed-out" }

const CHANNEL_NAME = "emass-auth"
const LOCK_NAME = "emass-auth-refresh"
const LEASE_KEY = "emass-auth-refresh-lease"
// A flag only (never a token): lets an anonymous visit skip the boot refresh
const HINT_KEY = "emass-has-session"
const REFRESH_TIMEOUT_MS = 8_000
const LEASE_MS = 10_000
// Codes requireAuth answers with when the access cookie is gone or unusable
const RETRYABLE_AUTH_CODES = new Set(["TOKEN_MISSING", "TOKEN_EXPIRED", "TOKEN_INVALID"])

type BroadcastMessage = { type: "active" } | { type: "signed-out" }

// Bumped on every session change (here or in another tab), so a tab can tell
// the session moved on while it waited for the lock; `active` is where it landed
let generation = 0
let active = false
let inflight: Promise<boolean> | null = null
const listeners = new Set<(event: SessionEvent) => void>()

const tabId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME)

channel?.addEventListener("message", (event: MessageEvent<BroadcastMessage>) => {
  if (event.data.type === "active") {
    markActive()
    emit({ type: "active", fromOtherTab: true })
  } else if (event.data.type === "signed-out") {
    clearLocal()
    emit({ type: "signed-out" })
  }
})

function emit(event: SessionEvent) {
  listeners.forEach((listener) => listener(event))
}

function markActive() {
  active = true
  generation += 1
}

function clearLocal() {
  active = false
  generation += 1
  writeHint(false)
}

function writeHint(on: boolean) {
  try {
    if (on) localStorage.setItem(HINT_KEY, "1")
    else localStorage.removeItem(HINT_KEY)
  } catch {
    // Storage blocked: every load just tries the refresh cookie
  }
}

export function hasSessionHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1"
  } catch {
    return true
  }
}

export function subscribe(listener: (event: SessionEvent) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Called after login / MFA verification (or a refresh) set fresh cookies. */
export function startSession() {
  markActive()
  writeHint(true)
  channel?.postMessage({ type: "active" } satisfies BroadcastMessage)
}

/** Drops the session in this tab and tells the other tabs. */
export function endSession() {
  clearLocal()
  channel?.postMessage({ type: "signed-out" } satisfies BroadcastMessage)
  emit({ type: "signed-out" })
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

type Lease = { owner: string; until: number }

function readLease(): Lease | null {
  try {
    const raw = localStorage.getItem(LEASE_KEY)
    return raw ? (JSON.parse(raw) as Lease) : null
  } catch {
    return null
  }
}

// Fallback when navigator.locks is missing (it needs a secure context). Not
// atomic like Web Locks, but write-then-confirm makes a collision unlikely and
// the lease expires if its tab dies mid-refresh.
async function withLease<T>(task: () => Promise<T>): Promise<T> {
  try {
    localStorage.getItem(LEASE_KEY)
  } catch {
    return task()
  }
  for (;;) {
    const lease = readLease()
    if (!lease || lease.until < Date.now()) {
      localStorage.setItem(LEASE_KEY, JSON.stringify({ owner: tabId, until: Date.now() + LEASE_MS } satisfies Lease))
      // Let racing tabs' writes land; the last writer owns the lease
      await sleep(40 + Math.random() * 40)
      if (readLease()?.owner === tabId) break
    } else {
      await sleep(100)
    }
  }
  try {
    return await task()
  } finally {
    if (readLease()?.owner === tabId) localStorage.removeItem(LEASE_KEY)
  }
}

function withDeviceLock<T>(task: () => Promise<T>): Promise<T> {
  if ("locks" in navigator && navigator.locks) return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, task)
  return withLease(task)
}

async function runRefresh(): Promise<boolean> {
  const seen = generation
  return withDeviceLock(async () => {
    // Another tab refreshed (or signed out) while we queued: its cookies are ours too
    if (generation !== seen) return active
    try {
      await apiRequest<void>("/auth/refresh", { method: "POST", signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })
      startSession()
      return true
    } catch (error) {
      // Missing, expired, revoked or reused refresh cookie: the session is over
      if (error instanceof ApiRequestError && error.status === 401) {
        endSession()
        return false
      }
      throw error
    }
  })
}

/** Single-flight refresh. Resolves true when fresh cookies are in place, false when signed out. */
export function refreshSession(): Promise<boolean> {
  inflight ??= runRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

const sessionEnded = () => new ApiRequestError(401, "SESSION_ENDED", "Your session has ended. Sign in again.")

/** apiRequest for signed-in calls: on an expired or missing access cookie, refreshes once and retries. */
export async function authorizedRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const seen = generation
  try {
    return await apiRequest<T>(path, options)
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401 || !RETRYABLE_AUTH_CODES.has(error.code)) throw error
    // Another caller may already have refreshed since this request went out
    const ok = generation !== seen ? active : await refreshSession()
    if (!ok) throw sessionEnded()
    return apiRequest<T>(path, options)
  }
}

/**
 * Multipart upload for signed-in calls. The server checks the cookie at the
 * start of the request but only answers once the whole body has arrived, so
 * a cheap authorized call first refreshes an expiring cookie before any
 * bytes go out; a 401 that still slips through refreshes once and resends.
 */
export async function authorizedUpload<T>(path: string, fields: [string, string][], file: File, options: UploadOptions = {}): Promise<T> {
  try {
    await authorizedRequest("/auth/me", { signal: options.signal })
  } catch (error) {
    // fetch reports an abort as TIMEOUT; for an upload it's a cancel
    if (options.signal?.aborted) throw uploadCancelled()
    throw error
  }
  const seen = generation
  try {
    return await uploadMultipart<T>(path, fields, file, options)
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401 || !RETRYABLE_AUTH_CODES.has(error.code)) throw error
    const ok = generation !== seen ? active : await refreshSession()
    if (!ok) throw sessionEnded()
    return uploadMultipart<T>(path, fields, file, options)
  }
}
