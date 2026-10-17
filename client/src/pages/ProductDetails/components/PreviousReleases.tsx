import { ChevronDown, Package } from "lucide-react"
import type { Product, ReleaseFile } from "@/pages/Catalog/catalog.types"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/common/StatusBadge"
import { ReleaseFileRow } from "./ReleaseFileRow"

export function PreviousReleases({ product, onDownload, onCopy }: { product: Product; onDownload: (file: ReleaseFile) => void; onCopy: (value: string, label: string) => void }) {
  return (
    <section id="previous" className="scroll-mt-24 space-y-4">
      <div><h2 className="text-xl font-semibold tracking-tight">Previous versions</h2><p className="mt-1 text-sm text-muted-foreground">Older releases remain available for compatibility.</p></div>
      <div className="space-y-3">
        {product.releases.slice(1).map((release) => (
          <details key={release.version} className="group rounded-xl border bg-card shadow-brand transition-colors open:border-primary/30">
            <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 transition-colors hover:bg-accent/40">
              <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground transition-colors group-open:bg-secondary group-open:text-primary"><Package className="size-4" /></div>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">Version <span className="font-mono">{release.version}</span></p><p className="mt-1 text-xs text-muted-foreground">Released {release.released} · {release.files.length} files</p></div>
              <StatusBadge status={release.status} />
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-4 border-t px-4 py-4">
              <ul className="space-y-1 text-sm text-muted-foreground">{release.notes.map((note) => <li key={note}>· {note}</li>)}</ul>
              {release.files.map((file) => <ReleaseFileRow key={file.name} file={file} onCopy={onCopy} onDownload={onDownload} />)}
              <div className="flex items-center justify-between gap-3"><code className="break-all font-mono text-xs text-muted-foreground">{release.command}</code><Button variant="outline" size="sm" onClick={() => onCopy(release.command, "Install command")}>Copy command</Button></div>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
