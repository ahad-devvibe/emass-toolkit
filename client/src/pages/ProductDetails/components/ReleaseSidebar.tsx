import { useState, type ReactNode } from "react"
import { BookOpen, ChevronRight, LifeBuoy, ScrollText, ShieldCheck } from "lucide-react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { osMeta, supportedOs } from "@/pages/Catalog/catalog.meta"
import type { Product, Release } from "@/pages/Catalog/catalog.types"
import { cn } from "@/lib/utils"
import { shortDate, totalSize } from "../release.utils"

const VISIBLE_VERSIONS = 5

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border bg-card p-4"><h2 className="mb-3 text-xs font-medium text-muted-foreground">{title}</h2>{children}</section>
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right">{children}</dd></div>
}

const resourceLink = "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"

type ReleaseSidebarProps = { product: Product; release: Release; onVersionChange: (version: string) => void; onOpenNotes?: () => void; hasDocumentation: boolean }

export function ReleaseSidebar({ product, release, onVersionChange, onOpenNotes, hasDocumentation }: ReleaseSidebarProps) {
  const [showAll, setShowAll] = useState(false)
  const latest = product.releases[0]
  const versions = showAll ? product.releases : product.releases.slice(0, VISIBLE_VERSIONS)

  return (
    <aside className="space-y-4 lg:sticky lg:top-20">
      <Panel title="This release">
        <dl className="space-y-2.5 text-sm">
          <Detail label="Version"><span className="font-mono font-medium">v{release.version}</span></Detail>
          <Detail label="Status"><StatusBadge status={release.status} label={release === latest ? "Latest" : "Archived"} /></Detail>
          <Detail label="Released">{shortDate(release.released)}</Detail>
          <Detail label="Files">{release.files.length} · {totalSize(release.files)}</Detail>
          <Detail label="Platforms"><span className="flex items-center gap-2">{supportedOs(release.files).map((os) => { const { Icon, label } = osMeta[os]; return <Icon key={os} role="img" aria-label={label} title={label} className="size-4 text-foreground/70" /> })}</span></Detail>
        </dl>
        <p className="mt-4 flex items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground"><ShieldCheck className="size-3.5 text-primary" />Every file has a SHA-256 checksum</p>
      </Panel>

      <Panel title="Versions">
        <ul className="-mx-2 space-y-0.5">
          {versions.map((item) => {
            const current = item === release
            return (
              <li key={item.version}>
                <button type="button" aria-current={current ? "true" : undefined} onClick={() => onVersionChange(item.version)} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent", current && "bg-accent text-accent-foreground")}>
                  <span className={cn("font-mono", current && "font-semibold")}>v{item.version}</span>
                  {item === latest && <span className="rounded-full bg-success/10 px-1.5 text-[11px] font-medium text-success">Latest</span>}
                  <span className="ml-auto text-xs text-muted-foreground">{shortDate(item.released)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {product.releases.length > VISIBLE_VERSIONS && <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-2 text-xs font-medium text-primary hover:underline">{showAll ? "Show fewer" : `Show all ${product.releases.length} versions`}</button>}
      </Panel>

      <Panel title="Resources">
        <ul className="-mx-2 space-y-0.5">
          {onOpenNotes && <li><button type="button" onClick={onOpenNotes} className={resourceLink}><ScrollText className="size-4 text-muted-foreground" />Release notes<ChevronRight className="ml-auto size-3.5 text-muted-foreground" /></button></li>}
          {hasDocumentation && <li><a href="#files-documentation" className={resourceLink}><BookOpen className="size-4 text-muted-foreground" />Documentation<ChevronRight className="ml-auto size-3.5 text-muted-foreground" /></a></li>}
          <li><a href="#support" className={resourceLink}><LifeBuoy className="size-4 text-muted-foreground" />Contact support<ChevronRight className="ml-auto size-3.5 text-muted-foreground" /></a></li>
        </ul>
      </Panel>
    </aside>
  )
}
