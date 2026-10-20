import { useSyncExternalStore } from "react"
import type { SessionUser } from "@/auth/auth.types"
import { authErrorMessage } from "@/auth/auth.messages"
import { subscribe as subscribeSession } from "@/auth/session"
import { signupsApi } from "./signups.api"

// Shared state for the pending-signups queue: the page's paginated, searchable
// list plus the full-queue count shown in the admin sidebar badge.
type State = {
  status: "idle" | "loading" | "ready" | "error"
  query: string
  signups: SessionUser[]
  nextCursor: string | null
  /** Matches for the current query */
  total: number
  error: string
  refreshing: boolean
  loadingMore: boolean
  moreError: string
  /** Whole queue, regardless of search; null until first fetched */
  badgeTotal: number | null
}

const initial: State = { status: "idle", query: "", signups: [], nextCursor: null, total: 0, error: "", refreshing: false, loadingMore: false, moreError: "", badgeTotal: null }

let state: State = initial
const listeners = new Set<() => void>()

function setState(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// Bumped by every first-page load; responses for an older query are ignored
let seq = 0

// Drop admin data when the session ends (sign-out here or in another tab)
subscribeSession((event) => {
  if (event.type === "signed-out") {
    seq += 1
    state = initial
    listeners.forEach((listener) => listener())
  }
})

/** Fetches the first page for `query` (default: the current one), replacing the list. */
export async function loadPendingSignups(query = state.query): Promise<void> {
  const mine = ++seq
  const sameQuery = query === state.query && state.status === "ready"
  // Keep showing the current list while refreshing the same search
  // Any in-flight "load more" belongs to the old list and is discarded (seq changed)
  setState(sameQuery ? { refreshing: true, loadingMore: false, moreError: "" } : { status: "loading", query, signups: [], nextCursor: null, error: "", loadingMore: false, moreError: "" })
  try {
    const page = await signupsApi.listPending({ q: query })
    if (mine !== seq) return
    setState({ status: "ready", signups: page.signups, nextCursor: page.nextCursor, total: page.total, refreshing: false, ...(query ? {} : { badgeTotal: page.total }) })
  } catch (error) {
    if (mine !== seq) return
    setState({ status: "error", error: authErrorMessage(error), refreshing: false })
  }
}

/** Appends the next page; a no-op when there is none or one is already loading. */
export async function loadMoreSignups(): Promise<void> {
  const { nextCursor, loadingMore, status, query } = state
  if (!nextCursor || loadingMore || status !== "ready") return
  const mine = seq
  setState({ loadingMore: true, moreError: "" })
  try {
    const page = await signupsApi.listPending({ q: query, cursor: nextCursor })
    if (mine !== seq) return
    // A row handled meanwhile could otherwise appear twice; keep ids unique
    const known = new Set(state.signups.map((signup) => signup.id))
    setState({ signups: [...state.signups, ...page.signups.filter((signup) => !known.has(signup.id))], nextCursor: page.nextCursor, total: page.total, loadingMore: false })
  } catch (error) {
    if (mine !== seq) return
    setState({ loadingMore: false, moreError: authErrorMessage(error) })
  }
}

/** Sidebar badge: just the queue size (limit=1), fetched once per admin session. */
export async function loadBadgeTotal(): Promise<void> {
  try {
    const { total } = await signupsApi.listPending({ limit: 1 })
    setState({ badgeTotal: total })
  } catch {
    // The badge is a hint; the page shows real errors
  }
}

export function removePendingSignup(id: string) {
  if (!state.signups.some((signup) => signup.id === id)) return
  setState({
    signups: state.signups.filter((signup) => signup.id !== id),
    total: Math.max(0, state.total - 1),
    badgeTotal: state.badgeTotal === null ? null : Math.max(0, state.badgeTotal - 1),
  })
}

export const usePendingSignups = () => useSyncExternalStore(subscribe, () => state)
