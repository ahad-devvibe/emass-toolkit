import { useState } from "react"
import { AlertCircle, AtSign, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { authErrorMessage } from "@/auth/auth.messages"
import { AppShell } from "@/components/common/AppShell"
import { DeleteDialog } from "@/components/common/dialogs"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import { shortDate } from "@/pages/ProductDetails/release.utils"
import { useResource } from "@/pages/Releases/useReleaseQueries"
import { domainsApi, type DomainKind, type DomainPolicy } from "./domains.api"
import { AddDomainDialog } from "./AddDomainDialog"
import { countByKind, filterDomains, kindLabels, type DomainFilter } from "./domains.utils"

const kindItems = (Object.keys(kindLabels) as DomainKind[]).map((kind) => ({ value: kind, label: kindLabels[kind] }))
const filters: { value: DomainFilter; label: string }[] = [{ value: "all", label: "All" }, ...kindItems.map(({ value, label }) => ({ value, label }))]

function KindBadge({ kind }: { kind: DomainKind }) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", kind === "COMPETITOR" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-secondary text-secondary-foreground")}>
      {kindLabels[kind]}
    </span>
  )
}

function DomainRow({ row, highlighted, onRemove }: { row: DomainPolicy; highlighted: boolean; onRemove: () => void }) {
  return (
    <li className={cn("flex items-center gap-3 px-4 py-2.5 transition-colors", highlighted && "bg-primary/5")}>
      <span className="min-w-0 flex-1 truncate font-mono text-sm" title={row.domain}>{row.domain}</span>
      <KindBadge kind={row.kind} />
      <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:inline">{shortDate(row.createdAt)}</span>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${row.domain}`} onClick={onRemove}><Trash2 /></Button>
    </li>
  )
}

export function DomainsPage() {
  const { data: domains, error, loading, reload, setData } = useResource("admin-domains", (signal) => domainsApi.list(signal))
  const [filter, setFilter] = useState<DomainFilter>("all")
  const [search, setSearch] = useState("")
  const [lastAdded, setLastAdded] = useState<string | null>(null)
  const [removing, setRemoving] = useState<DomainPolicy | null>(null)
  const [adding, setAdding] = useState(false)
  // Remounts the dialog on each open, so it starts empty
  const [addKey, setAddKey] = useState(0)

  const counts = countByKind(domains ?? [])
  const shown = filterDomains(domains ?? [], filter, search)

  function added(row: DomainPolicy) {
    setData([...(domains ?? []), row].sort((a, b) => a.domain.localeCompare(b.domain)))
    setLastAdded(row.id)
    toast.success(`${row.domain} added to ${kindLabels[row.kind].toLowerCase()}`)
    // Keep the new row in view
    setSearch("")
    if (filter !== "all" && filter !== row.kind) setFilter(row.kind)
  }

  function openAdd() {
    setAddKey((key) => key + 1)
    setAdding(true)
  }

  async function remove(row: DomainPolicy): Promise<boolean> {
    try {
      await domainsApi.remove(row.id)
      setData((domains ?? []).filter((item) => item.id !== row.id))
      toast(`${row.domain} removed`)
      return true
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.code === "DOMAIN_NOT_FOUND") {
        reload()
        toast(`${row.domain} was already removed`)
        return true
      }
      toast.error("Couldn't remove the domain", { description: authErrorMessage(caught) })
      return false
    }
  }

  return (
    <AppShell breadcrumb={["Admin", "Email domains"]}>
      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Email domains</h1>
            <p className="text-sm text-muted-foreground">Free-mail sign-ups wait for approval; competitor sign-ups are refused.</p>
          </div>
          <Button onClick={openAdd}><Plus />Add domain</Button>
        </div>

        <Card className="gap-0 overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <Tabs value={filter} onValueChange={(value) => setFilter(value as DomainFilter)}>
              <TabsList variant="line" className="w-max">
                {filters.map(({ value, label }) => (
                  <TabsTrigger key={value} value={value} className="px-2.5">
                    {label}
                    {domains && <span className="text-xs tabular-nums text-muted-foreground">{counts[value]}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="relative sm:w-56">
              <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input type="search" aria-label="Search domains" placeholder="Search domains" maxLength={100} className="h-9 pl-8" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
          </div>

          {!domains && loading ? (
            <ul aria-hidden className="divide-y">{[0, 1, 2, 3, 4].map((key) => <li key={key} className="flex items-center gap-3 px-4 py-3"><Skeleton className="h-4 w-40" /><span className="flex-1" /><Skeleton className="h-5 w-16 rounded-full" /></li>)}</ul>
          ) : error && !domains ? (
            <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
              <AlertCircle className="size-6 text-destructive" />
              <p className="text-sm text-muted-foreground">Couldn't load the domains. {error.message}</p>
              <Button variant="outline" size="sm" onClick={reload}>Try again</Button>
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground">{search ? <Search className="size-5" /> : <AtSign className="size-5" />}</span>
              <p className="text-sm font-medium">{search ? `No domains match “${search.trim()}”` : filter === "all" ? "No domains yet" : `No ${kindLabels[filter].toLowerCase()} domains yet`}</p>
              {search ? <Button variant="outline" size="sm" className="mt-1" onClick={() => setSearch("")}>Clear search</Button> : <Button variant="outline" size="sm" className="mt-1" onClick={openAdd}><Plus />Add domain</Button>}
            </div>
          ) : (
            <ul className="divide-y">{shown.map((row) => <DomainRow key={row.id} row={row} highlighted={row.id === lastAdded} onRemove={() => setRemoving(row)} />)}</ul>
          )}
        </Card>

        <AddDomainDialog key={addKey} open={adding} onOpenChange={setAdding} onAdded={added} />
        <DeleteDialog
          open={removing !== null}
          onOpenChange={(open) => { if (!open) setRemoving(null) }}
          itemName={removing?.domain ?? "domain"}
          confirmLabel="Remove"
          description={<>New sign-ups from this domain are treated like any company address. If it's still in <code className="font-mono text-xs">data/domain-policy.json</code>, the next domain seed adds it back.</>}
          onConfirm={() => (removing ? remove(removing) : Promise.resolve(true))}
        />
      </main>
    </AppShell>
  )
}
