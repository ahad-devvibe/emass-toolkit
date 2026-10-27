import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@/auth/useAuth"
import { AppShell } from "@/components/common/AppShell"
import { ReleaseTable } from "./components/ReleaseTable"
import { statusFilterOf } from "./releases.filters"
import { canCreateRelease } from "./release-permissions"
import { useProducts, useReleaseList } from "./useReleaseQueries"

// Product filters are UUIDs; anything else (e.g. an old ?product=core link) means all products
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function ReleasesPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const statusFilter = statusFilterOf(searchParams.get("status"))
  const productParam = searchParams.get("product") ?? ""
  const productId = UUID.test(productParam) ? productParam : "all"
  const query = searchParams.get("q") ?? ""

  const products = useProducts()
  const list = useReleaseList({ statuses: statusFilter.statuses, productId: productId === "all" ? undefined : productId, q: query || undefined })

  // Functional update so the debounced search never writes back a stale status or product
  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value === "all" || value === "") next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }, [setSearchParams])
  const setQuery = useCallback((value: string) => setParam("q", value), [setParam])

  return (
    <AppShell breadcrumb={["Workspace", "All Releases"]}>
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-8">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">All Releases</h1>
          <p className="mt-1 text-sm text-muted-foreground">Draft, review and publish SDK versions.</p>
        </header>
        <ReleaseTable
          releases={list.releases}
          counts={list.counts}
          products={products.data ?? []}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          hasMore={Boolean(list.nextCursor)}
          loadingMore={list.loadingMore}
          onLoadMore={() => void list.loadMore()}
          status={statusFilter.value}
          productId={productId}
          query={query}
          canCreate={user ? canCreateRelease(user.role) : false}
          // Admins review submissions; devs act on feedback
          highlightStatus={user?.role === "ADMIN" ? "in_review" : "changes_requested"}
          highlightCount={list.needsYou}
          onStatusChange={(value) => setParam("status", value)}
          onProductChange={(value) => setParam("product", value)}
          onQueryChange={setQuery}
        />
      </main>
    </AppShell>
  )
}
