import { apiRequest, ApiRequestError, type RequestOptions } from "@/lib/api/http"

/*
 * Access token + refresh coordination.
 *
 * The access token (15 min) lives in memory only. The refresh token is an
 * httpOnly cookie the server rotates on every /auth/refresh. Two refreshes
 * carrying the same cookie make the server treat the second as token reuse and
 * revoke every session the user has, so this module guarantees one /refresh in
 * flight per device:
 *   - within a tab, callers share one pending promise;
 *   - across tabs, the refresh runs under a device-wide lock (Web Locks, or a
 *     localStorage lease where Web Locks are unavailable, e.g. plain-http LAN);
 *   - the new token is broadcast to other tabs, and a tab that waited on the
 *     lock reuses it instead of calling /refresh again.
 */

export type SessionEvent = { type: "token"; fromOtherTab: boolean } | { type: "signed-out" }

const CHANNEL_NAME = "emass-auth"
const LOCK_NAME = "emass-auth-refresh"
const LEASE_KEY = "emass-auth-refresh-lease"
// A flag only (never a token): lets an anonymous visit skip the boot refresh
const HINT_KEY = "emass-has-session"
const EXPIRY_SKEW_MS = 30_000
const REFRESH_TIMEOUT_MS = 8_000
const LEASE_MS = 10_000

type BroadcastMessage = { type: "token"; accessToken: string } | { type: "signed-out" }

let accessToken: string | null = null
// Bumped whenever the token changes, so a tab can tell another tab refreshed while it waited
let generation = 0
let inflight: Promise<string | null> | null = null
const listeners = new Set<(event: SessionEvent) => void>()

const tabId = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL_NAME)

channel?.addEventListener("message", (event: MessageEvent<BroadcastMessage>) => {
  const message = event.data
  if (message.type === "token") {
    setToken(message.accessToken)
    emit({ type: "token", fromOtherTab: true })
  } else if (message.type === "signed-out") {
    clearLocal()
    emit({ type: "signed-out" })
  }
})

function emit(event: SessionEvent) {
  listeners.forEach((listener) => listener(event))
}

function setToken(token: string) {
  accessToken = token
  generation += 1
}

function clearLocal() {
  accessToken = null
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

/** Called after login / MFA verification hands us a fresh access token. */
export function startSession(token: string) {
  setToken(token)
  writeHint(true)
  channel?.postMessage({ type: "token", accessToken: token } satisfies BroadcastMessage)
}

/** Drops the session in this tab and tells the other tabs. */
export function endSession() {
  clearLocal()
  channel?.postMessage({ type: "signed-out" } satisfies BroadcastMessage)
  emit({ type: "signed-out" })
}

function expiresSoon(token: string): boolean {
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
    const { exp } = JSON.parse(atob(payload)) as { exp?: number }
    return !exp || exp * 1000 - Date.now() < EXPIRY_SKEW_MS
  } catch {
    return true
  }
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

async function runRefresh(): Promise<string | null> {
  const seen = generation
  return withDeviceLock(async () => {
    // Another tab refreshed while we queued for the lock: reuse its token
    if (generation !== seen && accessToken && !expiresSoon(accessToken)) return accessToken
    try {
      const data = await apiRequest<{ accessToken: string }>("/auth/refresh", { method: "POST", signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) })
      startSession(data.accessToken)
      return data.accessToken
    } catch (error) {
      // Missing, expired, revoked or reused refresh cookie: the session is over
      if (error instanceof ApiRequestError && error.status === 401) {
        endSession()
        return null
      }
      throw error
    }
  })
}

/** Single-flight refresh. Resolves to the new access token, or null when signed out. */
export function refreshAccessToken(): Promise<string | null> {
  inflight ??= runRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

async function validToken(): Promise<string | null> {
  if (accessToken && !expiresSoon(accessToken)) return accessToken
  return refreshAccessToken()
}

const sessionEnded = () => new ApiRequestError(401, "SESSION_ENDED", "Your session has ended. Sign in again.")

/** apiRequest with a Bearer token; refreshes first if needed and retries once on a rejected token. */
export async function authorizedRequest<T>(path: string, options: Omit<RequestOptions, "token"> = {}): Promise<T> {
  const token = await validToken()
  if (!token) throw sessionEnded()
  try {
    return await apiRequest<T>(path, { ...options, token })
  } catch (error) {
    if (!(error instanceof ApiRequestError) || error.status !== 401 || (error.code !== "TOKEN_EXPIRED" && error.code !== "TOKEN_INVALID")) throw error
    // Another caller may already have replaced the rejected token
    const next = accessToken && accessToken !== token ? accessToken : await refreshAccessToken()
    if (!next) throw sessionEnded()
    return apiRequest<T>(path, { ...options, token: next })
  }
}
