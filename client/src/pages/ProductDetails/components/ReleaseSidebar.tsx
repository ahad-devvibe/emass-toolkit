import type { ReactNode } from "react"
import { ScrollText } from "lucide-react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { osMeta, supportedOs } from "@/pages/Catalog/catalog.meta"
import type { Product, Release, ResourceFile } from "@/pages/Catalog/catalog.types"
import { shortDate, totalSize } from "../release.utils"
import { ResourceList } from "./ResourceList"

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs">
      <h2 className="text-sm font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-3 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="text-right font-medium">{children}</dd></div>
}

type ReleaseSidebarProps = { product: Product; release: Release; onOpenNotes?: () => void; onDownloadResource: (resource: ResourceFile) => void }

export function ReleaseSidebar({ product, release, onOpenNotes, onDownloadResource }: ReleaseSidebarProps) {
  const isLatest = release === product.releases[0]

  return (
    <aside className="space-y-4 lg:sticky lg:top-24">
      <section className="rounded-xl border bg-card p-4 shadow-xs">
        <p className="text-xs font-medium text-muted-foreground">This release</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="font-mono text-lg font-semibold">v{release.version}</p>
          <StatusBadge status={release.status} label={isLatest ? "Latest" : "Archived"} />
        </div>
        <dl className="mt-2 divide-y border-t text-sm">
          <Detail label="Released">{shortDate(release.released)}</Detail>
          <Detail label="Files">{release.files.length} · {totalSize(release.files)}</Detail>
          <Detail label="Platforms">
            <span className="flex items-center gap-2.5">
              {supportedOs(release.files).map((os) => {
                const { Icon, label } = osMeta[os]
                return (
                  <Tooltip key={os}>
                    <TooltipTrigger render={<span role="img" aria-label={label} className="text-foreground/70" />}><Icon className="size-4" /></TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </span>
          </Detail>
        </dl>
        {onOpenNotes && <Button variant="outline" size="sm" className="mt-3 w-full" onClick={onOpenNotes}><ScrollText />Release notes</Button>}
      </section>

      {product.resources.length > 0 && (
        <Panel title="Resources" description="Apply to every version">
          <ResourceList resources={product.resources} onDownload={onDownloadResource} />
        </Panel>
      )}
    </aside>
  )
}
