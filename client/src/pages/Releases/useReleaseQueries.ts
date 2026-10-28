import { useCallback, useEffect, useEffectEvent, useState, useSyncExternalStore } from "react"
import { useLocation } from "react-router-dom"
import { subscribe as subscribeSession } from "@/auth/session"
import { ApiRequestError } from "@/lib/api/http"
import { productsApi, releasesApi } from "./releases.api"
import type { ProductOption, ReleaseDetail, ReleaseFilters, ReleaseList, ReleaseSummary, VersionSuggestion } from "./releases.model"

// Small data hooks for the staff release pages, with no fetching library:
// one request per key, stale responses ignored, plus reload/setData.

export type Resource<T> = {
  data: T | null
  error: ApiRequestError | null
  /** True until the response for the current key (and reload) arrives. */
  loading: boolean
  reload: () => void
  /** Replace the data in place, e.g. with what a mutation returned. */
  setData: (next: T) => void
}

type Loaded<T> = { key: string; nonce: number; data: T | null; error: ApiRequestError | null }

const asApiError = (error: unknown) => (error instanceof ApiRequestError ? error : new ApiRequestError(0, "UNKNOWN", "Something went wrong. Try again."))

/** Data already in hand for `key` (e.g. the response that created it), shown while it loads again. */
export function initialLoaded<T>(key: string | null, initial: T | undefined): Loaded<T> | null {
  return key !== null && initial !== undefined ? { key, nonce: 0, data: initial, error: null } : null
}

/**
 * Loads `load()` whenever `key` changes; a null key loads nothing. With
 * `keepPrevious`, the last data stays visible while the next key loads
 * (filters, badges) instead of blanking. `initial` is shown at once and
 * replaced when the load finishes.
 */
export function useResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>, { keepPrevious = false, initial }: { keepPrevious?: boolean; initial?: T } = {}): Resource<T> {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(() => initialLoaded(key, initial))
  const [nonce, setNonce] = useState(0)
  const run = useEffectEvent((signal: AbortSignal) => load(signal))

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setLoaded({ key, nonce, data, error: null })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setLoaded({ key, nonce, data: null, error: asApiError(error) })
      },
    )
    return () => controller.abort()
  }, [key, nonce])

  const current = loaded !== null && loaded.key === key
  const reload = useCallback(() => setNonce((value) => value + 1), [])
  const setData = useCallback((next: T) => {
    if (key !== null) setLoaded({ key, nonce, data: next, error: null })
  }, [key, nonce])

  return {
    data: current || keepPrevious ? (loaded?.data ?? null) : null,
    error: current ? loaded.error : null,
    loading: key !== null && (!current || loaded.nonce !== nonce),
    reload,
    setData,
  }
}

export function useProducts(): Resource<ProductOption[]> {
  return useResource("products", () => productsApi.list())
}

/** `initial` (the release as just created) skips the loader; it's used only if it's the same release. */
export function useRelease(id: string | undefined, initial?: ReleaseDetail): Resource<ReleaseDetail> & { notFound: boolean } {
  const resource = useResource(id ?? null, () => releasesApi.get(id!), { initial: initial?.id === id ? initial : undefined })
  return { ...resource, notFound: resource.error?.code === "RELEASE_NOT_FOUND" }
}

/** Highest shipped version and patch/minor/major suggestions for a product. */
export function useVersionSuggestion(productId: string | null): Resource<VersionSuggestion> {
  return useResource(productId ? `next-version:${productId}` : null, () => releasesApi.nextVersion(productId!))
}

type ListFilters = Omit<ReleaseFilters, "cursor">
type MorePages = { key: string; releases: ReleaseSummary[]; nextCursor: string | null }

/** First page per filter set, plus "Load more" pages appended in place. */
export function useReleaseList(filters: ListFilters) {
  const key = JSON.stringify(filters)
  const first = useResource<ReleaseList>(key, () => releasesApi.list(filters), { keepPrevious: true })
  const [more, setMore] = useState<MorePages | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState<ApiRequestError | null>(null)

  const extra = more?.key === key ? more : null
  const releases = first.data ? [...first.data.releases, ...(extra?.releases ?? [])] : []
  const nextCursor = extra ? extra.nextCursor : (first.data?.nextCursor ?? null)

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    try {
      const page = await releasesApi.list({ ...filters, cursor: nextCursor })
      setMore({ key, releases: [...(extra?.releases ?? []), ...page.releases], nextCursor: page.nextCursor })
    } catch (error) {
      setMoreError(asApiError(error))
    } finally {
      setLoadingMore(false)
    }
  }

  const reload = () => {
    setMore(null)
    first.reload()
  }

  return { releases, counts: first.data?.counts ?? null, needsYou: first.data?.needsYou ?? null, nextCursor, loading: first.loading, error: first.error, reload, loadMore, loadingMore, moreError }
}

// Bumped after any action that changes a release's status, so badges and
// counts refetch even when the route stays the same
let releasesVersion = 0
const versionListeners = new Set<() => void>()

export function notifyReleasesChanged(): void {
  releasesVersion++
  for (const listener of versionListeners) listener()
}

function useReleasesVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      versionListeners.add(listener)
      return () => versionListeners.delete(listener)
    },
    () => releasesVersion,
  )
}

type ReleaseBadges = Pick<ReleaseList, "counts" | "needsYou">

/** Per-status counts and the viewer's to-do count for nav badges; refetched on route change and after release actions. */
// Every page mounts its own shell, so the sidebar's counts would start empty on each
// navigation; keep the last answer here (dropped on sign-out) to bridge the refetch
let lastCounts: ReleaseBadges | null = null
subscribeSession((event) => {
  if (event.type === "signed-out") lastCounts = null
})

export function useReleaseCounts(enabled: boolean): ReleaseBadges | null {
  const { pathname } = useLocation()
  const version = useReleasesVersion()
  const { data } = useResource(enabled ? `counts:${pathname}:${version}` : null, async (): Promise<ReleaseBadges> => {
    const { counts, needsYou } = await releasesApi.list({ limit: 1 })
    return { counts, needsYou }
  }, { keepPrevious: true })
  useEffect(() => {
    if (data) lastCounts = data
  }, [data])
  return enabled ? (data ?? lastCounts) : null
}
