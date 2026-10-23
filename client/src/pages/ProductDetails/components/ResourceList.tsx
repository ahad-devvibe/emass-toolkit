import { ArrowDownToLine, FileArchive, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ResourceFile } from "@/pages/Catalog/catalog.types"

/** Product-level files that apply to every version (datasheets, schematics, brand assets). */
export function ResourceList({ resources, onDownload }: { resources: ResourceFile[]; onDownload: (resource: ResourceFile) => void }) {
  if (resources.length === 0) return null

  return (
    <ul className="-mx-2 space-y-0.5">
      {resources.map((resource) => {
        const Icon = resource.format === "ZIP" ? FileArchive : FileText
        return (
          <li key={resource.name} className="flex items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/60">
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground/70"><Icon aria-hidden className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={resource.name}>{resource.title}</p>
              <p className="text-xs text-muted-foreground">{resource.format} · {resource.size}</p>
            </div>
            <Button size="icon-sm" variant="ghost" aria-label={`Download ${resource.title}`} onClick={() => onDownload(resource)}><ArrowDownToLine /></Button>
          </li>
        )
      })}
    </ul>
  )
}
