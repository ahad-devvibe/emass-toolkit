import { useState, type ReactNode } from "react"
import { ArrowLeft, Ban, CircleAlert, FileQuestion, Info, MessageSquareWarning, RefreshCw, RotateCcw, TriangleAlert } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/auth/useAuth"
import { AppShell } from "@/components/common/AppShell"
import { PageLoader } from "@/components/common/PageLoader"
import { Button, buttonVariants } from "@/components/ui/button"
import { osMeta, supportedOs } from "@/pages/Catalog/catalog.meta"
import { ReleaseFiles } from "@/pages/ProductDetails/components/ReleaseFiles"
import { ReleaseNotes } from "@/pages/ProductDetails/components/ReleaseNotes"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { ReleaseStatusBadge } from "@/pages/Releases/components/ReleaseStatusBadge"
import { ProductIcon } from "@/pages/Releases/product-meta"
import { relativeTime } from "@/pages/Releases/releases.utils"
import { useRelease } from "@/pages/Releases/useReleaseQueries"
import { releasesApi } from "@/pages/Releases/releases.api"
import type { ReleaseFile as CatalogReleaseFile } from "@/pages/Catalog/catalog.types"
import { downloadFromServer } from "@/lib/download"
import { cn } from "@/lib/utils"
import { ActivityTimeline } from "./components/ActivityTimeline"
import { ReleaseActions } from "./components/ReleaseActions"
import { filesUpdatedAfterFeedback, latestEvent, toCatalogFile } from "./release-detail.utils"

function Callout({ tone, icon, title, children }: { tone: "amber" | "info" | "danger"; icon: ReactNode; title: string; children?: ReactNode }) {
  const styles = { amber: "border-amber-500/30 bg-amber-500/10 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400", info: "border-primary/25 bg-primary/5 [&>svg]:text-primary", danger: "border-destructive/30 bg-destructive/5 [&>svg]:text-destructive" }
  return (
    <div role="note" className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", styles[tone])}>
      {icon}
      <div className="min-w-0 flex-1"><p className="font-medium">{title}</p>{children && <div className="mt-0.5 whitespace-pre-line text-foreground/80">{children}</div>}</div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right">{children}</dd></div>
}

function Centered({ breadcrumb, title, body, action }: { breadcrumb: string; title: string; body: string; action: ReactNode }) {
  return (
    <AppShell breadcrumb={["All Releases", breadcrumb]}>
      <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-6">{action}</div>
      </main>
    </AppShell>
  )
}

export function ReleaseDetailPage({ releaseId }: { releaseId?: string }) {
  const { user } = useAuth()
  const { data: release, error, loading, notFound, reload, setData } = useRelease(releaseId)
  const [notesOpen, setNotesOpen] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  if (notFound) return <Centered breadcrumb="Not found" title="Release not found" body="It may have been deleted." action={<Button render={<Link to="/releases" />}>Back to releases</Button>} />
  if (error) return <Centered breadcrumb="Error" title="Couldn't load this release" body={error.message} action={<Button variant="outline" onClick={reload}><RefreshCw />Try again</Button>} />
  if (!release || !user) return <PageLoader />

  const files = release.files.map(toCatalogFile).filter((file) => file !== null)
  // Drafts can hold files without a type, or SDKs without a platform
  const unmapped = release.files.filter((file) => toCatalogFile(file) === null)
  const feedback = latestEvent(release, "changes_requested")
  const rolledBack = latestEvent(release, "rolled_back")
  const updated = release.status === "in_review" ? filesUpdatedAfterFeedback(release) : []
  const platforms = supportedOs(files)
  // The server judges files only before publishing, so shipped releases have none
  const blocked = release.files.filter((file) => file.blockedBy.length > 0)
  const warned = release.files.filter((file) => file.warnings.length > 0)

  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); toast.success(`${label} copied to clipboard`) } catch { toast.error("Clipboard access is unavailable in this browser") } }
  // Works in every state; unpublished files get a short link, and staff downloads go to the activity log
  async function download(file: CatalogReleaseFile) {
    if (downloadingId || !release) return
    setDownloadingId(file.id)
    await downloadFromServer(() => releasesApi.downloadFile(release.id, file.id))
    setDownloadingId(null)
  }

  return (
    <AppShell breadcrumb={["All Releases", `${release.product.name} v${release.version}`]}>
      <main aria-busy={loading || undefined} className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <header className="space-y-4">
          <Link to="/releases" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />All Releases</Link>
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70"><ProductIcon productId={release.product.id} className="size-5" /></span>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold tracking-tight">{release.product.name} <span className="font-mono text-xl font-semibold text-muted-foreground">v{release.version}</span><ReleaseStatusBadge status={release.status} /></h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Created by {release.createdBy.name} · updated {relativeTime(release.updatedAt)}</p>
            </div>
          </div>
        </header>

        {release.status === "changes_requested" && feedback && <Callout tone="amber" icon={<MessageSquareWarning />} title={`Changes requested by ${feedback.actor.name}`}>{feedback.note}</Callout>}
        {release.status === "in_review" && user.role === "ADMIN" && (
          <Callout tone="info" icon={<Info />} title="Waiting for your review">
            {feedback ? <>Previously requested: {feedback.note}</> : "Check the files and notes, then publish it or request changes."}
          </Callout>
        )}
        {updated.length > 0 && (
          <Callout tone="info" icon={<CircleAlert />} title={`${updated.length} ${updated.length === 1 ? "file" : "files"} updated after feedback`}>
            {updated.map((file) => file.name).join(", ")}
          </Callout>
        )}
        {blocked.length > 0 && (
          <Callout tone="danger" icon={<Ban />} title={`${blocked.length} ${blocked.length === 1 ? "file can't" : "files can't"} be submitted`}>
            <ul className="space-y-0.5">
              {blocked.flatMap((file) => file.blockedBy.map((reason, index) => <li key={`${file.id}-${index}`}><span className="font-medium">{file.name}</span>: {reason.message}</li>))}
            </ul>
          </Callout>
        )}
        {warned.length > 0 && (
          <Callout tone="amber" icon={<TriangleAlert />} title={`${warned.length} ${warned.length === 1 ? "file has" : "files have"} warnings`}>
            <ul className="space-y-0.5">
              {warned.flatMap((file) => file.warnings.map((warning, index) => <li key={`${file.id}-${index}`}><span className="font-medium">{file.name}</span>: {warning.message}</li>))}
            </ul>
          </Callout>
        )}
        {release.status === "rolled_back" && rolledBack && <Callout tone="danger" icon={<RotateCcw />} title={`Rolled back by ${rolledBack.actor.name}`}>{rolledBack.note}</Callout>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-4">
            {files.length > 0 && <ReleaseFiles files={files} version={{ version: release.version, released: release.publishedAt ?? undefined }} downloadingId={downloadingId} onDownload={download} onCopy={copy} />}
            {unmapped.length > 0 && (
              <section className="rounded-xl border border-dashed bg-card px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><FileQuestion className="size-4 text-amber-600 dark:text-amber-400" />Needs a type or platform <span className="rounded-full bg-muted px-2 text-xs font-normal tabular-nums text-muted-foreground">{unmapped.length}</span></h2>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{unmapped.map((file) => <li key={file.id} className="truncate">{file.name} · {formatBytes(file.sizeBytes)}</li>)}</ul>
              </section>
            )}
            {release.files.length === 0 && <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">No files uploaded yet.</div>}
            {release.releaseNotes && <ReleaseNotes notes={release.releaseNotes} open={notesOpen} onOpenChange={setNotesOpen} />}
          </div>

          {/* Capped at the viewport on lg so the sticky column never hides its own bottom; Activity scrolls inside */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)]">
            <div className="shrink-0">
              <ReleaseActions release={release} viewer={user} onUpdated={setData} onStale={reload} />
            </div>
            <section className="shrink-0 rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Summary</h2>
              <dl className="space-y-2.5 text-sm">
                <Detail label="Files">{release.fileCount} · {formatBytes(release.totalBytes)}</Detail>
                <Detail label="Platforms">
                  <span className="flex items-center gap-2">{platforms.map((os) => { const { Icon: OsIcon, label } = osMeta[os]; return <OsIcon key={os} role="img" aria-label={label} title={label} className="size-4 text-foreground/70" /> })}{platforms.length === 0 && <span className="text-muted-foreground">None</span>}</span>
                </Detail>
                <Detail label="Release notes">{release.releaseNotes ? "Yes" : <span className="text-muted-foreground">None</span>}</Detail>
              </dl>
            </section>
            <section className="flex min-h-0 flex-col rounded-xl border bg-card p-4">
              <h2 className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">Activity <span className="rounded-full bg-muted px-2 font-normal tabular-nums">{release.events.length}</span></h2>
              <ActivityTimeline events={release.events} />
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
