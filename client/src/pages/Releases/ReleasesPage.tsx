import { ChevronRight, Inbox, MessageSquareWarning, Plus } from "lucide-react"
import { Link, useSearchParams } from "react-router-dom"
import { useAuth } from "@/auth/useAuth"
import { AppShell } from "@/components/common/AppShell"
import { StatusBadge } from "@/components/common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { products } from "@/pages/Catalog/catalog.data"
import { canCreateRelease } from "./release-permissions"
import type { ManagedRelease, ReleaseStatus } from "./releases.types"
import { lastEvent, relativeTime, statusLabels } from "./releases.utils"
import { useReleases } from "./useReleases"

type Filter = "all" | Exclude<ReleaseStatus, "rolled_back">

const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in_review", label: "In review" },
  { value: "draft", label: "Drafts" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
]

const productItems = [{ value: "all", label: "All products" }, ...products.map((product) => ({ value: product.id, label: product.name }))]

// Archived also lists rolled-back builds: both are out of customers' hands
const matches = (release: ManagedRelease, filter: Filter) => filter === "all" || release.status === filter || (filter === "archived" && release.status === "rolled_back")

function ReleaseRow({ release, canReview }: { release: ManagedRelease; canReview: boolean }) {
  const product = products.find((item) => item.id === release.productId)
  const Icon = product?.icon
  const feedback = release.status === "changes_requested" ? lastEvent(release, "changes_requested")?.note : undefined

  return (
    <li className="relative flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-accent/40 sm:gap-4">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70">{Icon && <Icon className="size-4" />}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          {/* The stretched link makes the whole row clickable without nesting interactive elements */}
          <Link to={`/releases/${release.id}`} className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline">{product?.name ?? release.productId}</Link>
          <span className="font-mono text-muted-foreground">v{release.version}</span>
          <StatusBadge status={release.status} />
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {release.files.length} {release.files.length === 1 ? "file" : "files"} · {release.createdBy.name} · updated {relativeTime(release.updatedAt)}
        </p>
        {feedback && <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-amber-700 dark:text-amber-300"><MessageSquareWarning className="size-3.5 shrink-0" /><span className="truncate">{feedback}</span></p>}
      </div>
      {canReview && release.status === "in_review"
        ? <Button size="sm" className="relative z-10" render={<Link to={`/releases/${release.id}`} />}>Review</Button>
        : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </li>
  )
}

export function ReleasesPage() {
  const { user } = useAuth()
  const { releases } = useReleases()
  const [searchParams, setSearchParams] = useSearchParams()
  const status = (filters.find((item) => item.value === searchParams.get("status"))?.value ?? "all") as Filter
  const productId = productItems.some((item) => item.value === searchParams.get("product")) ? searchParams.get("product")! : "all"

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value === "all") next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const forProduct = releases.filter((release) => productId === "all" || release.productId === productId)
  const visible = forProduct.filter((release) => matches(release, status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const canCreate = user ? canCreateRelease(user.role) : false

  return (
    <AppShell breadcrumb={["Workspace", status === "in_review" ? "Review queue" : "Releases"]}>
      <main className="mx-auto w-full max-w-5xl space-y-5 px-4 py-8 sm:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Releases</h1>
            <p className="mt-1 text-sm text-muted-foreground">Draft, review and publish SDK versions.</p>
          </div>
          <Select items={productItems} value={productId} onValueChange={(value) => setParam("product", String(value ?? "all"))}>
            <SelectTrigger aria-label="Filter by product" className="h-9 w-full bg-card sm:w-48"><SelectValue /></SelectTrigger>
            <SelectContent>{productItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <Tabs value={status} onValueChange={(value) => setParam("status", String(value))}>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <TabsList variant="line" className="w-max">
              {filters.map((filter) => {
                const count = forProduct.filter((release) => matches(release, filter.value)).length
                return (
                  <TabsTrigger key={filter.value} value={filter.value} className="px-2.5">
                    {filter.label}
                    <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{count}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </div>
        </Tabs>

        {visible.length > 0 ? (
          <ul className="divide-y overflow-hidden rounded-xl border bg-card">
            {visible.map((release) => <ReleaseRow key={release.id} release={release} canReview={user?.role === "ADMIN"} />)}
          </ul>
        ) : (
          <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
            <Inbox className="size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{status === "all" ? "No releases yet" : `Nothing ${statusLabels[status as ReleaseStatus].toLowerCase()}`}</p>
            <p className="mt-1 text-sm text-muted-foreground">{status === "in_review" ? "Submitted releases will show up here for review." : "Releases you create will show up here."}</p>
            {canCreate && <Button size="sm" className="mt-4" render={<Link to="/releases/new" />}><Plus />New release</Button>}
          </div>
        )}
      </main>
    </AppShell>
  )
}
