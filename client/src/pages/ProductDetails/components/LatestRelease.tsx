import { Check, Copy, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/common/StatusBadge"
import type { Product, ReleaseFile } from "@/pages/Catalog/catalog.types"
import { ReleaseFileRow } from "./ReleaseFileRow"

export function LatestRelease({ product, onCopy, onDownload }: { product: Product; onCopy: (value: string, label: string) => void; onDownload: (file: ReleaseFile) => void }) {
  const release = product.releases[0]
  return (
    <section id="latest" className="relative scroll-mt-24 space-y-5 overflow-hidden rounded-2xl border bg-card p-5 shadow-brand sm:p-6">
      <div aria-hidden className="absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
      <div>
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold tracking-tight">Latest stable release <span className="font-mono text-primary">v{release.version}</span></h2><StatusBadge status={release.status} /></div>
        <p className="mt-1 text-sm text-muted-foreground">Released {release.released} · {release.files.length} platform files</p>
      </div>
      <div className="space-y-2">{release.files.map((file) => <ReleaseFileRow key={file.name} file={file} onCopy={onCopy} onDownload={onDownload} />)}</div>
      <div className="flex items-center justify-between gap-2 rounded-xl bg-muted/70 p-4">
        <div className="min-w-0 flex-1"><p className="text-xs font-medium text-muted-foreground">Install command</p><code className="mt-1 block break-all font-mono text-xs">{release.command}</code></div>
        <Button size="icon" variant="ghost" aria-label="Copy install command" onClick={() => onCopy(release.command, "Install command")}><Copy /></Button>
      </div>
      <div><h3 className="mb-2 text-sm font-semibold">What’s included</h3><ul className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">{release.notes.map((note) => <li key={note}><Check className="mr-2 inline size-4 text-success" />{note}</li>)}</ul></div>
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />Every file is checksum verified.</p>
    </section>
  )
}
