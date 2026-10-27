import { Ban, FileQuestion, Loader2, RefreshCw, Replace, TriangleAlert, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fileKindMeta, osMeta } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { cn } from "@/lib/utils"
import type { QueueItem } from "../upload-queue"
import { FileMappingSelects } from "./FileMappingSelects"

function ItemIcon({ item }: { item: QueueItem }) {
  if (item.kind === "sdk" && item.os) { const { Icon } = osMeta[item.os]; return <Icon aria-hidden className="size-4" /> }
  if (item.kind) { const { Icon } = fileKindMeta[item.kind]; return <Icon aria-hidden className="size-4" /> }
  return <FileQuestion aria-hidden className="size-4" />
}

function statusText(item: QueueItem): string {
  switch (item.status) {
    case "conflict": return "Not uploaded yet"
    case "queued": return "Waiting to check"
    case "checking": return item.sha256 ? "Checking…" : "Checking versions…"
    case "hashing": return `Checking ${Math.floor((item.hashed / Math.max(item.sizeBytes, 1)) * 100)}%`
    case "uploading": return `Uploading ${Math.floor((item.loaded / Math.max(item.sizeBytes, 1)) * 100)}%${item.kind ? "" : " · choose its type once it's in"}`
    case "finalizing": return "Finalizing…"
    case "done": return "Uploaded"
    case "cancelled": return "Cancelled"
    case "failed": return item.error?.message ?? "Upload failed"
    case "blocked": return "Can't be added"
  }
}

type QueueRowProps = {
  item: QueueItem
  /** Name of the file holding this item's platform (resolved from the release when only an id is known). */
  holderName?: string | null
  onMap: (kind: FileKind | null, os: OperatingSystem | null) => void
  onCancel: () => void
  onRetry: () => void
  onReplace: () => void
  onDismiss: () => void
}

/** A file on its way to the draft: progress, then it joins the file list. */
export function QueueRow({ item, holderName, onMap, onCancel, onRetry, onReplace, onDismiss }: QueueRowProps) {
  const active = ["queued", "checking", "hashing", "uploading", "finalizing"].includes(item.status)
  const blocked = item.status === "blocked"
  const percent = item.status === "finalizing" ? 100 : (item.loaded / Math.max(item.sizeBytes, 1)) * 100
  const held = item.status === "conflict"
  const platform = item.os ? osMeta[item.os].label : "This platform"
  const canReplace = held && Boolean(item.holder?.fileId)

  return (
    <li className={cn("space-y-3 px-4 py-3.5", held && "bg-amber-500/5", blocked && "bg-destructive/5")}>
      <div className="flex items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70", (held || item.status === "failed") && "bg-amber-500/10 text-amber-600 dark:text-amber-400", blocked && "bg-destructive/10 text-destructive")}>{blocked ? <Ban aria-hidden className="size-4" /> : <ItemIcon item={item} />}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
          <p className={cn("mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground", (item.status === "failed" || blocked) && "text-destructive")}>
            <span>{formatBytes(item.sizeBytes)}</span>
            <span aria-hidden>·</span>
            {(item.status === "finalizing" || item.status === "checking") && <Loader2 aria-hidden className="size-3 animate-spin" />}
            <span className="truncate tabular-nums" aria-live="polite">{statusText(item)}</span>
          </p>
        </div>
        {active
          ? <Button type="button" variant="ghost" size="icon-sm" aria-label={`Cancel upload of ${item.name}`} onClick={onCancel}><X /></Button>
          : <Button type="button" variant="ghost" size="icon-sm" aria-label={`Dismiss ${item.name}`} onClick={onDismiss}><X /></Button>}
      </div>

      {(item.status === "uploading" || item.status === "finalizing") && (
        <div className="h-1 overflow-hidden rounded-full bg-muted sm:ml-12" role="progressbar" aria-label={`Uploading ${item.name}`} aria-valuenow={Math.floor(percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full bg-primary transition-[width] duration-150", item.status === "finalizing" && "animate-pulse")} style={{ width: `${percent}%` }} />
        </div>
      )}

      {item.status === "hashing" && (
        <div className="h-1 overflow-hidden rounded-full bg-muted sm:ml-12" role="progressbar" aria-label={`Checking ${item.name}`} aria-valuenow={Math.floor((item.hashed / Math.max(item.sizeBytes, 1)) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-muted-foreground/40 transition-[width] duration-150" style={{ width: `${(item.hashed / Math.max(item.sizeBytes, 1)) * 100}%` }} />
        </div>
      )}

      {blocked && (
        <div role="alert" className="space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs sm:ml-12">
          <p className="font-medium">This file wasn't uploaded</p>
          <ul className="space-y-0.5">{item.blockedBy.map((reason, index) => <li key={index}>{reason.message}</li>)}</ul>
          <Button type="button" size="xs" variant="outline" onClick={onDismiss}>Remove</Button>
        </div>
      )}

      {!blocked && item.warnings.length > 0 && (
        <ul aria-label={`Warnings for ${item.name}`} className="space-y-1 sm:pl-12">
          {item.warnings.map((warning, index) => (
            <li key={index} className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400"><TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />{warning.message}</li>
          ))}
        </ul>
      )}

      {held && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs sm:ml-12">
          <p role="status">
            <span className="font-medium">{platform} is already uploaded</span>
            {holderName && <> ({holderName})</>}.{" "}
            {canReplace ? "Replace it with this file, or change this file's type." : "Change this file's type or platform, or remove the other upload."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {canReplace && <Button type="button" size="xs" onClick={onReplace}><Replace />Replace {holderName ?? "it"}</Button>}
            <FileMappingSelects name={item.name} kind={item.kind} os={item.os} onChange={onMap} />
          </div>
        </div>
      )}

      {(item.status === "failed" || item.status === "cancelled") && (
        <div className="sm:pl-12"><Button type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw />Retry</Button></div>
      )}
    </li>
  )
}
