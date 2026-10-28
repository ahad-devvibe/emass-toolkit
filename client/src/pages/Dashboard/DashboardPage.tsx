import type { ReactNode } from "react"
import { AlertCircle, ArrowRight, Ban, Clock3, Download, Inbox, Layers, RefreshCw, ShieldX, UserCheck, Users, type LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { AppShell } from "@/components/common/AppShell"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { countryLabel } from "@/lib/countries/countries"
import { cn } from "@/lib/utils"
import { ProductIcon } from "@/pages/Releases/product-meta"
import { relativeTime } from "@/pages/Releases/releases.utils"
import type { Dashboard } from "./dashboard.api"
import { breakdown, compactCount, moreCount } from "./dashboard.utils"
import { useDashboard } from "./useDashboard"

// value and detail are null while the first load is in flight; format defaults to the full number
type StatProps = { label: string; value: number | null; detail: string | null; Icon: LucideIcon; to?: string; tone?: "default" | "amber"; format?: (value: number) => string }

function Stat({ label, value, detail, Icon, to, tone = "default", format }: StatProps) {
  const exact = value?.toLocaleString()
  const shown = value !== null && format ? format(value) : exact
  const body = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={cn("grid size-8 place-items-center rounded-lg bg-secondary text-primary", tone === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400")}><Icon aria-hidden className="size-4" /></span>
      </div>
      {value === null ? <Skeleton className="mt-3 mb-1 h-7 w-14" /> : <p className={cn("mt-2 text-3xl font-bold tabular-nums tracking-tight", tone === "amber" && "text-amber-700 dark:text-amber-300")} title={shown !== exact ? exact : undefined}>{shown}</p>}
      {detail === null ? <Skeleton className="mt-2 h-3 w-28" /> : <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>}
    </>
  )
  const frame = "rounded-xl bg-card p-4 ring-1 ring-border"
  return to ? <Link to={to} className={cn(frame, "block outline-none transition-shadow hover:ring-primary/35 focus-visible:ring-2 focus-visible:ring-ring")}>{body}</Link> : <div className={frame}>{body}</div>
}

/** A queue card. Both queue cards share a grid row, so they always match in height. */
function Panel({ title, count, action, children }: { title: string; count: number | null; action: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex h-full flex-col gap-0 overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          {title}
          {count === null ? <Skeleton className="ml-2 inline-block h-4 w-6 align-middle" /> : <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-secondary-foreground">{count}</span>}
        </h2>
        {action}
      </div>
      {/* Room for five rows, so the cards don't shrink or jump as queues empty */}
      <div className="flex min-h-[19rem] flex-1 flex-col">{children}</div>
    </Card>
  )
}

function Empty({ Icon, text }: { Icon: LucideIcon; text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
      <span className="grid size-9 place-items-center rounded-full bg-muted"><Icon aria-hidden className="size-4" /></span>
      {text}
    </div>
  )
}

// Widths rotate so the placeholder rows don't look stamped
const ROW_WIDTHS = [["w-44", "w-32"], ["w-36", "w-40"], ["w-52", "w-28"], ["w-40", "w-36"], ["w-48", "w-32"]]

function LoadingRows({ withIcon }: { withIcon?: boolean }) {
  return (
    <ul aria-hidden className="divide-y">
      {ROW_WIDTHS.map(([title, sub], index) => (
        <li key={index} className="flex items-center gap-3 px-4 py-3">
          {withIcon && <Skeleton className="size-9 shrink-0 rounded-lg" />}
          <span className="min-w-0 flex-1 space-y-2"><Skeleton className={cn("h-4", title)} /><Skeleton className={cn("h-3", sub)} /></span>
          <Skeleton className="h-3 w-12 shrink-0" />
        </li>
      ))}
    </ul>
  )
}

function More({ count, noun }: { count: number; noun: string }) {
  return count > 0 ? <p className="mt-auto border-t px-4 py-2 text-xs text-muted-foreground">+{count} more {noun}</p> : null
}

function Waited({ at }: { at: string }) {
  return <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Clock3 aria-hidden className="size-3.5" />{relativeTime(at)}</span>
}

const viewAll = cn(buttonVariants({ variant: "ghost", size: "sm" }), "-mr-2 text-primary")

function ReleaseQueue({ alerts }: { alerts: Dashboard["releaseAlerts"] | null }) {
  return (
    <Panel title="Waiting for review" count={alerts?.total ?? null} action={<Link to="/releases?status=in_review" className={viewAll}>View all<ArrowRight /></Link>}>
      {!alerts ? <LoadingRows withIcon /> : alerts.items.length === 0 ? <Empty Icon={Layers} text="No releases waiting for review" /> : (
        <ul className="divide-y">
          {alerts.items.map((release) => (
            <li key={release.id}>
              <Link to={`/releases/${release.id}`} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70"><ProductIcon productId={release.product.id} className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{release.product.name} <span className="font-mono text-muted-foreground">v{release.version}</span></span>
                  <span className="block truncate text-xs text-muted-foreground">Submitted by {release.createdBy.name}</span>
                </span>
                <Waited at={release.submittedAt} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {alerts && <More count={moreCount(alerts.items.length, alerts.total)} noun="in review" />}
    </Panel>
  )
}

function SignupQueue({ alerts }: { alerts: Dashboard["signupAlerts"] | null }) {
  return (
    <Panel title="Signup Requests" count={alerts?.total ?? null} action={<Link to="/admin/signups" className={viewAll}>Review all<ArrowRight /></Link>}>
      {!alerts ? <LoadingRows /> : alerts.items.length === 0 ? <Empty Icon={Inbox} text="No sign-ups waiting for approval" /> : (
        <ul className="divide-y">
          {alerts.items.map((signup) => (
            <li key={signup.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{signup.firstName} {signup.lastName}</span>
                <span className="block truncate text-xs text-muted-foreground" title={signup.email}>{signup.email} · {signup.companyName} · {countryLabel(signup.country)}</span>
              </span>
              <Waited at={signup.createdAt} />
            </li>
          ))}
        </ul>
      )}
      {alerts && <More count={moreCount(alerts.items.length, alerts.total)} noun="waiting" />}
    </Panel>
  )
}

const statGrid = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"

export function DashboardPage() {
  const { data, error, refreshing, refresh } = useDashboard()

  return (
    <AppShell breadcrumb={["Admin", "Dashboard"]}>
      <main aria-busy={refreshing || undefined} className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-sm text-muted-foreground">Accounts and what needs your attention.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}><RefreshCw className={refreshing ? "animate-spin" : undefined} />Refresh</Button>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
            <AlertCircle className="size-4 shrink-0 text-destructive" />
            <p className="flex-1">{data ? "Couldn't refresh. Showing the last numbers we got." : `Couldn't load the dashboard. ${error.message}`}</p>
            <Button variant="outline" size="sm" onClick={refresh}>Try again</Button>
          </div>
        )}

        {/* The real cards render from the start; numbers and rows show placeholders until the first load */}
        {(data || !error) && (
          <>
            <section aria-label="Totals" aria-busy={!data || undefined} className={statGrid}>
              <Stat label="Active users" value={data?.users.active ?? null} detail={data ? breakdown([[data.users.activeCustomers, "customers"], [data.users.activeStaff, "staff"]], "No active accounts") : null} Icon={Users} />
              <Stat label="Pending sign-ups" value={data?.users.pendingApproval ?? null} detail="Waiting for approval" Icon={UserCheck} to="/admin/signups" tone={data && data.users.pendingApproval > 0 ? "amber" : "default"} />
              <Stat label="Competitors blocked" value={data?.users.blockedCompetitor ?? null} detail="Signed up with a competitor domain" Icon={ShieldX} />
              <Stat label="Sign-ups rejected" value={data?.users.blockedRejected ?? null} detail="Declined by an admin" Icon={Ban} />
              <Stat label="Total downloads" value={data?.downloads.total ?? null} detail={data ? `${compactCount(data.downloads.last30Days)} in the last 30 days` : null} Icon={Download} format={compactCount} />
            </section>
            <div className="grid gap-6 lg:grid-cols-2">
              <ReleaseQueue alerts={data?.releaseAlerts ?? null} />
              <SignupQueue alerts={data?.signupAlerts ?? null} />
            </div>
          </>
        )}
      </main>
    </AppShell>
  )
}
