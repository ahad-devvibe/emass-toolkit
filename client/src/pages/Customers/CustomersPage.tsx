import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, RefreshCw, Search, Users } from "lucide-react"
import { useSearchParams } from "react-router-dom"
import { AppShell } from "@/components/common/AppShell"
import { UserAvatar } from "@/components/common/UserAvatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { shortDate } from "@/pages/ProductDetails/release.utils"
import { relativeTime } from "@/pages/Releases/releases.utils"
import { useResource } from "@/pages/Releases/useReleaseQueries"
import { CUSTOMERS_PAGE_SIZE, customersApi, type Customer } from "./customers.api"
import { CustomerDetailsDialog } from "./CustomerDetailsDialog"
import { CustomerStatusBadge } from "./CustomerStatusBadge"
import { currentCursor, downloadsLabels, downloadsParam, formatCount, formatExact, fullName, nextPage, pageRange, previousPage, statusLabels, statusParam, type PageStack } from "./customers.utils"

const SEARCH_DEBOUNCE_MS = 200

const statusItems = [{ value: "all", label: "All statuses" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]
const downloadItems = [{ value: "all", label: "All customers" }, ...Object.entries(downloadsLabels).map(([value, label]) => ({ value, label }))]

// One column layout for the header and every row. Downloads gets room for
// "999.9K" right-aligned, so counts line up whatever their size
const columns = "md:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_8.5rem_6rem_minmax(0,1.5fr)]"

function CustomerRow({ customer, onOpen }: { customer: Customer; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className={cn("grid w-full grid-cols-1 items-center gap-x-6 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none", columns)}>
        <span className="flex min-w-0 items-center gap-3">
          <UserAvatar user={customer} className="size-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{fullName(customer)}</span>
            <span className="block truncate text-xs text-muted-foreground">{customer.email}</span>
          </span>
        </span>
        <span className="min-w-0 text-sm max-md:pl-12">
          <span className="block truncate">{customer.companyName}</span>
          <span className="block truncate text-xs text-muted-foreground">Joined {shortDate(customer.createdAt)}</span>
        </span>
        <span className="max-md:pl-12"><CustomerStatusBadge status={customer.status} /></span>
        <span className="text-sm font-medium tabular-nums max-md:pl-12 md:text-right" title={`${formatExact(customer.downloadCount)} downloads`} aria-label={`${formatExact(customer.downloadCount)} downloads`}><span aria-hidden className="font-normal text-muted-foreground md:hidden">Downloads </span>{formatCount(customer.downloadCount)}</span>
        <span className="min-w-0 text-sm max-md:pl-12" title={customer.lastDownloadLabel ?? undefined}>
          {customer.lastDownloadAt ? (
            <>
              <span className="block truncate">{relativeTime(customer.lastDownloadAt)}</span>
              {customer.lastDownloadLabel && <span className="block truncate text-xs text-muted-foreground">{customer.lastDownloadLabel}</span>}
            </>
          ) : <span className="text-muted-foreground">Never</span>}
        </span>
      </button>
    </li>
  )
}

function LoadingRows() {
  return (
    <ul aria-hidden className="divide-y">
      {Array.from({ length: 8 }, (_, index) => (
        <li key={index} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2"><Skeleton className={cn("h-3.5", index % 2 ? "w-40" : "w-52")} /><Skeleton className="h-3 w-64 max-w-full" /></div>
        </li>
      ))}
    </ul>
  )
}

/** Admin: every customer, newest first, with the download totals kept on their account. */
export function CustomersPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const query = searchParams.get("q") ?? ""
  const status = statusParam(searchParams.get("status"))
  const downloads = downloadsParam(searchParams.get("downloads"))
  const filterKey = JSON.stringify({ query, status, downloads })

  // Pages visited under these filters; changing a filter starts again at page one
  const [pages, setPages] = useState<{ key: string; stack: PageStack }>({ key: filterKey, stack: [] })
  const stack = pages.key === filterKey ? pages.stack : []
  const cursor = currentCursor(stack)

  const { data, error, loading, reload } = useResource(
    `${filterKey}|${cursor ?? ""}`,
    (signal) => customersApi.list({ q: query || undefined, status, downloads }, cursor, signal),
    { keepPrevious: true },
  )
  const [selected, setSelected] = useState<Customer | null>(null)

  const setParam = useCallback((key: string, value: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value === "all" || value === "") next.delete(key)
      else next.set(key, value)
      return next
    }, { replace: true })
  }, [setSearchParams])

  // The input stays responsive; the URL (and the request) follow after a short pause
  const [search, setSearch] = useState(query)
  useEffect(() => {
    if (search.trim() === query) return
    const timer = window.setTimeout(() => setParam("q", search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search, query, setParam])

  const customers = data?.customers ?? []
  const filtered = Boolean(query || status || downloads)
  const firstLoad = !data && !error

  return (
    <AppShell breadcrumb={["Admin", "Customers"]}>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <header className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
            <p className="mt-1 text-sm text-muted-foreground">Every customer account, newest first, with their downloads. Select one for details.</p>
          </div>
          {/* Reloads the page being viewed, keeping the filters and the page */}
          <Button variant="outline" className="shrink-0" disabled={loading} onClick={reload} aria-label="Refresh customers">
            <RefreshCw className={cn(loading && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </header>

        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center">
            <div className="relative md:w-80">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search customers" placeholder="Search name, email or company" maxLength={100} className="h-9 pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="flex gap-3 md:ml-auto">
              <Select items={statusItems} value={status ?? "all"} onValueChange={(value) => setParam("status", String(value ?? "all"))}>
                <SelectTrigger aria-label="Filter by status" className="w-full md:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{statusItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
              <Select items={downloadItems} value={downloads ?? "all"} onValueChange={(value) => setParam("downloads", String(value ?? "all"))}>
                <SelectTrigger aria-label="Filter by downloads" className="w-full md:w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{downloadItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div aria-hidden className={cn("hidden gap-x-6 border-b bg-muted/30 px-5 py-2.5 text-xs font-medium text-muted-foreground md:grid", columns)}>
            <span>Customer</span><span>Company</span><span>Status</span><span className="text-right">Downloads</span><span>Last download</span>
          </div>

          {error && !data ? (
            <div role="alert" className="px-6 py-12 text-center text-sm">
              <p className="text-muted-foreground">{error.message}</p>
              <Button variant="outline" className="mt-4" onClick={reload}><RefreshCw />Try again</Button>
            </div>
          ) : firstLoad ? (
            <LoadingRows />
          ) : customers.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              <Users aria-hidden className="mx-auto mb-2 size-5" />
              {filtered ? "No customers match these filters." : "No customers yet."}
            </div>
          ) : (
            <ul aria-busy={loading || undefined} className={cn("divide-y transition-opacity", loading && "opacity-60")}>
              {customers.map((customer) => <CustomerRow key={customer.id} customer={customer} onOpen={() => setSelected(customer)} />)}
            </ul>
          )}

          {data && (
            <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
              <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">{pageRange(stack, CUSTOMERS_PAGE_SIZE, customers.length, data.total)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={stack.length === 0 || loading} onClick={() => setPages({ key: filterKey, stack: previousPage(stack) })}><ChevronLeft />Previous</Button>
                <Button variant="outline" size="sm" disabled={!data.nextCursor || loading} onClick={() => data.nextCursor && setPages({ key: filterKey, stack: nextPage(stack, data.nextCursor) })}>Next<ChevronRight /></Button>
              </div>
            </div>
          )}
        </Card>
      </main>
      <CustomerDetailsDialog customer={selected} onOpenChange={(open) => { if (!open) setSelected(null) }} />
    </AppShell>
  )
}
