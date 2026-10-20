import { useState, type ReactNode } from "react"
import { ArrowLeft, FileQuestion, Info, MessageSquareWarning, RotateCcw } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { useAuth } from "@/auth/useAuth"
import { AppShell } from "@/components/common/AppShell"
import { StatusBadge } from "@/components/common/StatusBadge"
import { Button, buttonVariants } from "@/components/ui/button"
import { products } from "@/pages/Catalog/catalog.data"
import { osMeta, supportedOs } from "@/pages/Catalog/catalog.meta"
import type { ReleaseFile } from "@/pages/Catalog/catalog.types"
import { ReleaseFiles } from "@/pages/ProductDetails/components/ReleaseFiles"
import { ReleaseNotes } from "@/pages/ProductDetails/components/ReleaseNotes"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { lastEvent, relativeTime, toReleaseFiles } from "@/pages/Releases/releases.utils"
import { useReleases } from "@/pages/Releases/useReleases"
import { cn } from "@/lib/utils"
import { ActivityTimeline } from "./components/ActivityTimeline"
import { ReleaseActions } from "./components/ReleaseActions"

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

export function ReleaseDetailPage({ releaseId }: { releaseId?: string }) {
  const { user } = useAuth()
  const { releases } = useReleases()
  const [notesOpen, setNotesOpen] = useState(false)
  const release = releases.find((item) => item.id === releaseId)

  if (!release || !user) {
    return (
      <AppShell breadcrumb={["Releases", "Not found"]}>
        <main className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-5xl flex-col items-center justify-center px-6 text-center">
          <h1 className="text-2xl font-semibold">Release not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">It may have been deleted.</p>
          <Button className="mt-6" render={<Link to="/releases" />}>Back to releases</Button>
        </main>
      </AppShell>
    )
  }

  const product = products.find((item) => item.id === release.productId)
  const productName = product?.name ?? release.productId
  const Icon = product?.icon
  const files = toReleaseFiles(release.files)
  const unmapped = release.files.filter((file) => !files.some((mapped) => mapped.name === file.name))
  const totalBytes = release.files.reduce((sum, file) => sum + file.sizeBytes, 0)
  const feedback = lastEvent(release, "changes_requested")
  const rolledBack = lastEvent(release, "rolled_back")

  async function copy(value: string, label: string) { try { await navigator.clipboard.writeText(value); toast.success(`${label} copied to clipboard`) } catch { toast.error("Clipboard access is unavailable in this browser") } }
  function download(file: ReleaseFile) { toast.success(`${file.name} is ready to download`) }

  return (
    <AppShell breadcrumb={["Releases", `${productName} v${release.version}`]}>
      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-8">
        <header className="space-y-4">
          <Link to="/releases" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 text-muted-foreground")}><ArrowLeft />Releases</Link>
          <div className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted text-foreground/70">{Icon && <Icon className="size-5" />}</span>
            <div className="min-w-0">
              <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl font-bold tracking-tight">{productName} <span className="font-mono text-xl font-semibold text-muted-foreground">v{release.version}</span><StatusBadge status={release.status} /></h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Created by {release.createdBy.name} · updated {relativeTime(release.updatedAt)}</p>
            </div>
          </div>
        </header>

        {release.status === "changes_requested" && feedback && <Callout tone="amber" icon={<MessageSquareWarning />} title={`Changes requested by ${feedback.actor.name}`}>{feedback.note}</Callout>}
        {release.status === "in_review" && user.role === "ADMIN" && <Callout tone="info" icon={<Info />} title="Waiting for your review">Check the files and notes, then publish it or request changes.</Callout>}
        {release.status === "rolled_back" && rolledBack && <Callout tone="danger" icon={<RotateCcw />} title={`Rolled back by ${rolledBack.actor.name}`}>{rolledBack.note}</Callout>}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start">
          <div className="space-y-4">
            {files.length > 0 && <ReleaseFiles files={files} recommendedOs={null} onDownload={download} onCopy={copy} />}
            {unmapped.length > 0 && (
              <section className="rounded-xl border border-dashed bg-card px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-semibold"><FileQuestion className="size-4 text-amber-600 dark:text-amber-400" />Not mapped yet <span className="rounded-full bg-muted px-2 text-xs font-normal tabular-nums text-muted-foreground">{unmapped.length}</span></h2>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">{unmapped.map((file) => <li key={file.name} className="truncate">{file.name} · {formatBytes(file.sizeBytes)}</li>)}</ul>
              </section>
            )}
            {release.files.length === 0 && <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">No files uploaded yet.</div>}
            {release.releaseNotes && <ReleaseNotes notes={release.releaseNotes} open={notesOpen} onOpenChange={setNotesOpen} />}
          </div>

          <aside className="space-y-4 lg:sticky lg:top-20">
            <ReleaseActions release={release} role={user.role} productName={productName} />
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Summary</h2>
              <dl className="space-y-2.5 text-sm">
                <Detail label="Files">{release.files.length} · {formatBytes(totalBytes)}</Detail>
                <Detail label="Platforms">
                  <span className="flex items-center gap-2">{supportedOs(files).map((os) => { const { Icon: OsIcon, label } = osMeta[os]; return <OsIcon key={os} role="img" aria-label={label} title={label} className="size-4 text-foreground/70" /> })}{supportedOs(files).length === 0 && <span className="text-muted-foreground">None</span>}</span>
                </Detail>
                <Detail label="Release notes">{release.releaseNotes ? "Yes" : <span className="text-muted-foreground">None</span>}</Detail>
              </dl>
            </section>
            <section className="rounded-xl border bg-card p-4">
              <h2 className="mb-3 text-xs font-medium text-muted-foreground">Activity</h2>
              <ActivityTimeline events={release.events} />
            </section>
          </aside>
        </div>
      </main>
    </AppShell>
  )
}
