import { useEffect, useState } from "react"
import { ChevronRight, Loader2, Plus, Search } from "lucide-react"
import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import { ProductIcon } from "../product-meta"
import { statusFilterOf, statusFilters, tabCount, type StatusFilter } from "../releases.filters"
import type { ProductOption, ReleaseSummary } from "../releases.model"
import type { ReleaseStatus } from "../releases.types"
import { relativeTime } from "../releases.utils"
import { ReleaseStatusBadge } from "./ReleaseStatusBadge"
import { versionLabel } from "@/pages/Releases/version.utils"

const SEARCH_DEBOUNCE_MS = 200

// Product | Version | Status | Files | Created | chevron; phones stack into two lines instead
const rowGrid = "sm:grid sm:grid-cols-[minmax(0,1fr)_6.5rem_10.5rem_4rem_8.5rem_1rem] sm:items-center sm:gap-4"

function ReleaseRow({ release }: { release: ReleaseSummary }) {
  const files = `${release.fileCount} ${release.fileCount === 1 ? "file" : "files"}`
  const created = relativeTime(release.createdAt)

  return (
    <li className={`${rowGrid} relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70"><ProductIcon productId={release.product.id} className="size-4" /></span>
        <div className="min-w-0">
          {/* The stretched link makes the whole row clickable without nesting interactive elements */}
          <Link to={`/releases/${release.id}`} className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:underline">
            {release.product.name}
            <span className="ml-2 font-mono text-muted-foreground sm:hidden">{versionLabel(release.version)}</span>
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">{files} · {created} · {release.createdBy.name}</p>
        </div>
      </div>
      <span className="hidden font-mono text-sm font-semibold sm:block">{versionLabel(release.version)}</span>
      <span><ReleaseStatusBadge status={release.status} /></span>
      <span className="hidden text-sm tabular-nums text-muted-foreground sm:block">{files}</span>
      <span className="hidden min-w-0 sm:block">
        <span className="block text-sm text-muted-foreground">{created}</span>
        <span className="block truncate text-xs text-muted-foreground/80">{release.createdBy.name}</span>
      </span>
      <ChevronRight aria-hidden className="hidden size-4 text-muted-foreground sm:block" />
    </li>
  )
}

function RowSkeletons() {
  return (
    <ul aria-hidden className="divide-y">
      {Array.from({ length: 4 }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="size-8 rounded-lg" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-40 sm:block" />
        </li>
      ))}
    </ul>
  )
}

type ReleaseTableProps = {
  releases: ReleaseSummary[]
  counts: Record<ReleaseStatus, number> | null
  products: ProductOption[]
  loading: boolean
  error: ApiRequestError | null
  onRetry: () => void
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  status: StatusFilter
  productId: string
  query: string
  canCreate: boolean
  /** The tab holding the viewer's to-do; its count shows as a notification badge */
  highlightStatus?: StatusFilter
  /** The viewer's own to-do in that tab (a dev sees only their releases); defaults to the tab total */
  highlightCount?: number | null
  onStatusChange: (status: StatusFilter) => void
  onProductChange: (productId: string) => void
  onQueryChange: (query: string) => void
}

/** Every release, newest created first; the server applies the tab, product and search filters. */
export function ReleaseTable({ releases, counts, products, loading, error, onRetry, hasMore, loadingMore, onLoadMore, status, productId, query, canCreate, highlightStatus, highlightCount, onStatusChange, onProductChange, onQueryChange }: ReleaseTableProps) {
  // The input stays responsive; the URL (and the request) follow after a short pause
  const [search, setSearch] = useState(query)
  useEffect(() => {
    if (search.trim() === query) return
    const timer = window.setTimeout(() => onQueryChange(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search, query, onQueryChange])

  const productItems = [{ value: "all", label: "All products" }, ...products.map((product) => ({ value: product.id, label: product.name }))]
  const firstLoad = loading && releases.length === 0 && !error

  function clearSearch() {
    setSearch("")
    onQueryChange("")
  }

  return (
    <section aria-label="All Releases" className="space-y-4">
      <Tabs value={status} onValueChange={(value) => onStatusChange(value as StatusFilter)}>
        {/* Room for the active underline, which sits below the list; without it the strip overflows
            vertically and Windows draws scroll arrows. Phones swipe the tabs with the bar hidden. */}
        <div className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-1.5 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
          <TabsList variant="line" className="w-max">
            {statusFilters.map((filter) => {
              const count = counts ? tabCount(filter.value, counts) : null
              const mine = filter.value === highlightStatus ? (highlightCount ?? count) : null
              return (
                <TabsTrigger key={filter.value} value={filter.value} className="px-2.5">
                  {filter.label}
                  {count === null ? null : mine ? (
                    <span aria-label={`${mine} need${mine === 1 ? "s" : ""} your action`} className="grid h-5 min-w-5 place-items-center rounded-full bg-[#0d72b9] px-1.5 text-[11px] font-bold tabular-nums text-white dark:bg-[#7cc6f8] dark:text-[#0b2147]">{mine}</span>
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>
      </Tabs>

      <Card className="gap-0 overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative sm:w-80">
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search releases" placeholder="Search product, version or author" maxLength={100} className="h-9 pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <Select items={productItems} value={productId} onValueChange={(value) => onProductChange(String(value ?? "all"))}>
            <SelectTrigger aria-label="Filter by product" className="w-full sm:w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        {error ? (
          <div role="alert" className="flex flex-col items-center px-6 py-14 text-center">
            <p className="text-sm font-medium">Couldn't load releases</p>
            <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>Try again</Button>
          </div>
        ) : firstLoad ? (
          <RowSkeletons />
        ) : releases.length > 0 ? (
          <>
            <div aria-hidden className={`${rowGrid} hidden border-b bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground`}>
              <span>Product</span><span>Version</span><span>Status</span><span>Files</span><span>Created</span><span />
            </div>
            {/* Previous rows stay (dimmed) while a new filter loads */}
            <ul aria-busy={loading || undefined} className={cn("divide-y transition-opacity", loading && "opacity-60")}>{releases.map((release) => <ReleaseRow key={release.id} release={release} />)}</ul>
            {hasMore && (
              <div className="border-t px-4 py-3 text-center">
                <Button size="sm" variant="outline" onClick={onLoadMore} disabled={loadingMore}>{loadingMore && <Loader2 className="animate-spin" />}Load more</Button>
              </div>
            )}
          </>
        ) : query ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <p className="text-sm font-medium">No releases match “{query}”</p>
            <Button size="sm" variant="outline" className="mt-4" onClick={clearSearch}>Clear search</Button>
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <p className="text-sm font-medium">{statusFilterOf(status).empty}</p>
            <p className="mt-1 text-sm text-muted-foreground">Releases show up here as soon as they're created.</p>
            {canCreate && <Button size="sm" className="mt-4" render={<Link to="/releases/new" />}><Plus />New Release</Button>}
          </div>
        )}
      </Card>
    </section>
  )
}
