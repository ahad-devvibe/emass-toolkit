import { useRef, type ChangeEvent } from "react"
import { Ban, FileQuestion, FolderOpen, Loader2, Pause, Play, RefreshCw, Replace, TriangleAlert, X } from "lucide-react"
import { Link } from "react-router-dom"
import { Button, buttonVariants } from "@/components/ui/button"
import { fileKindMeta, osMeta } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { cn } from "@/lib/utils"
import { FileMappingSelects } from "@/pages/ReleaseEditor/components/FileMappingSelects"
import { pickOneFile, type FileHandle } from "./file-source"
import { rowActions } from "./row-actions"
import type { QueueItem } from "./uploads.state"
import { useNow } from "./useNow"

function ItemIcon({ item }: { item: QueueItem }) {
  if (item.kind === "sdk" && item.os) { const { Icon } = osMeta[item.os]; return <Icon aria-hidden className="size-4" /> }
  if (item.kind) { const { Icon } = fileKindMeta[item.kind]; return <Icon aria-hidden className="size-4" /> }
  return <FileQuestion aria-hidden className="size-4" />
}

function retryIn(item: QueueItem, now: number): string {
  if (item.retryAt === null) return "Offline · resumes when you reconnect"
  const seconds = Math.max(1, Math.ceil((item.retryAt - now) / 1000))
  const reason = item.retryReason
  if (reason?.kind === "server") return `Server error · retrying in ${seconds}\u00a0s (attempt ${reason.attempt})`
  if (reason?.kind === "network") return `Connection lost · retrying in ${seconds}\u00a0s (attempt ${reason.attempt})`
  // A non-breaking space keeps "5 s" on one line
  return `Reconnecting… retrying in ${seconds}\u00a0s`
}

const percentOf = (item: QueueItem) => Math.floor((item.loaded / Math.max(item.sizeBytes, 1)) * 100)

function statusText(item: QueueItem, now: number): string {
  switch (item.status) {
    case "conflict": return "Not uploaded yet"
    case "queued": return "Waiting to check"
    case "checking": return item.sha256 ? "Checking…" : "Checking versions…"
    case "hashing": return `Checking ${Math.floor((item.hashed / Math.max(item.sizeBytes, 1)) * 100)}%`
    case "uploading": return `Uploading ${percentOf(item)}%${item.kind ? "" : " · choose its type once it's in"}`
    case "finalizing": return "Finalizing…"
    case "waiting": return retryIn(item, now)
    case "paused": return `Paused at ${percentOf(item)}%`
    // A file that was still waiting its turn lost nothing: it starts from the check
    case "needsFile": return item.error?.message ?? (item.sha256 ? "Interrupted by a refresh" : "Not started yet · resumes with the others")
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
  /** The panel's narrow row: a held file is resolved in its editor, not here. */
  compact?: boolean
  /** The editor's version field differs from the saved one (the server checks the saved one). */
  versionUnsaved?: boolean
  onMap?: (kind: FileKind | null, os: OperatingSystem | null) => void
  onReplace?: () => void
  onPause: () => void
  onResume: () => void
  /** Reopens the file from its stored handle; must run from the click itself. */
  onResumeWithHandle: () => void
  onPickFile: (file: File, handle: FileHandle | null) => void
  onCancel: () => void
  onRetry: () => void
  onDismiss: () => void
}

/** A file on its way to a draft: progress and its controls, then it joins the file list. */
export function QueueRow({ item, holderName, compact = false, versionUnsaved = false, onMap, onReplace, onPause, onResume, onResumeWithHandle, onPickFile, onCancel, onRetry, onDismiss }: QueueRowProps) {
  const now = useNow(1000, item.status === "waiting" && item.retryAt !== null)
  const inputRef = useRef<HTMLInputElement>(null)
  const actions = rowActions(item, { compact })
  const blocked = item.status === "blocked"
  const held = item.status === "conflict"
  const stopped = item.status === "paused" || item.status === "needsFile"
  const percent = item.status === "finalizing" ? 100 : (item.loaded / Math.max(item.sizeBytes, 1)) * 100
  const platform = item.os ? osMeta[item.os].label : "This platform"
  const canReplace = held && Boolean(item.holder?.fileId) && !compact

  // The browser's picker keeps a handle for next time; the plain input where there is none
  async function pickFile() {
    const picked = await pickOneFile()
    if (picked === "unsupported") inputRef.current?.click()
    else if (picked) onPickFile(picked.file, picked.handle)
  }
  function picked(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) onPickFile(file, null)
    event.target.value = ""
  }

  const iconButton = "text-muted-foreground hover:text-foreground"
  return (
    <li className={cn("space-y-3 py-3.5", compact ? "px-3" : "px-4", held && "bg-amber-500/5", blocked && "bg-destructive/5")}>
      <div className="flex items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70", (held || item.status === "failed" || stopped) && "bg-amber-500/10 text-amber-600 dark:text-amber-400", blocked && "bg-destructive/10 text-destructive")}>{blocked ? <Ban aria-hidden className="size-4" /> : <ItemIcon item={item} />}</span>
        <div className="min-w-0 flex-1">
          {compact
            ? <Link to={`/releases/${item.releaseId}/edit`} className="block truncate text-sm font-medium outline-none hover:underline focus-visible:underline" title={`${item.name} · open ${item.releaseLabel || "its release"}`}>{item.name}</Link>
            : <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>}
          <p className={cn("mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground", (item.status === "failed" || blocked) && "text-destructive", item.status === "needsFile" && item.error && "text-amber-700 dark:text-amber-400")}>
            <span className="shrink-0">{formatBytes(item.sizeBytes)}</span>
            <span aria-hidden>·</span>
            {(item.status === "finalizing" || item.status === "checking" || item.status === "waiting") && <Loader2 aria-hidden className="size-3 shrink-0 animate-spin" />}
            <span className={cn("tabular-nums", compact ? "line-clamp-2" : "truncate")} title={item.status === "waiting" && item.retryReason ? item.retryReason.message : undefined}>{statusText(item, now)}</span>
          </p>
        </div>
        <div className="flex shrink-0 items-center">
          {actions.includes("pause") && <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Pause ${item.name}`} title="Pause" onClick={onPause}><Pause /></Button>}
          {actions.includes("resume") && <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Resume ${item.name}`} title="Resume" onClick={onResume}><Play /></Button>}
          {actions.includes("cancel") && <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Cancel upload of ${item.name}`} title="Cancel" onClick={onCancel}><X /></Button>}
          {actions.includes("dismiss") && <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Dismiss ${item.name}`} title="Dismiss" onClick={onDismiss}><X /></Button>}
        </div>
      </div>

      {["uploading", "finalizing", "waiting", "paused", "needsFile"].includes(item.status) && (
        <div className={cn("h-1 overflow-hidden rounded-full bg-muted", !compact && "sm:ml-12")} role="progressbar" aria-label={`Uploading ${item.name}`} aria-valuenow={Math.floor(percent)} aria-valuemin={0} aria-valuemax={100}>
          <div className={cn("h-full rounded-full bg-primary transition-[width] duration-150", item.status === "finalizing" && "animate-pulse", stopped && "bg-amber-500")} style={{ width: `${percent}%` }} />
        </div>
      )}

      {item.status === "hashing" && (
        <div className={cn("h-1 overflow-hidden rounded-full bg-muted", !compact && "sm:ml-12")} role="progressbar" aria-label={`Checking ${item.name}`} aria-valuenow={Math.floor((item.hashed / Math.max(item.sizeBytes, 1)) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-muted-foreground/40 transition-[width] duration-150" style={{ width: `${(item.hashed / Math.max(item.sizeBytes, 1)) * 100}%` }} />
        </div>
      )}

      {(actions.includes("resumeWithHandle") || actions.includes("pickFile")) && (
        <div className={cn("flex flex-wrap gap-2", !compact && "sm:pl-12")}>
          {actions.includes("resumeWithHandle")
            ? <Button type="button" size="sm" onClick={onResumeWithHandle}><Play />Resume</Button>
            : <Button type="button" size="sm" onClick={() => void pickFile()}><FolderOpen />Pick {item.name}</Button>}
          <input ref={inputRef} type="file" hidden onChange={picked} />
        </div>
      )}

      {blocked && (
        <div role="alert" className={cn("space-y-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs", !compact && "sm:ml-12")}>
          <p className="font-medium">This file wasn't uploaded</p>
          <ul className="space-y-0.5">{item.blockedBy.map((reason, index) => <li key={index}>{reason.message}</li>)}</ul>
          {actions.includes("checkAgain") && <p className="text-foreground/80">{versionUnsaved ? "Changed the version? Save the draft, then check again." : "Fix the release version and it's checked again, or remove it."}</p>}
          <div className="flex flex-wrap gap-2">
            {actions.includes("checkAgain") && <Button type="button" size="xs" onClick={onRetry} disabled={versionUnsaved}><RefreshCw />Check again</Button>}
            <Button type="button" size="xs" variant="outline" onClick={onDismiss}>Remove</Button>
          </div>
        </div>
      )}

      {!blocked && item.warnings.length > 0 && (
        <ul aria-label={`Warnings for ${item.name}`} className={cn("space-y-1", !compact && "sm:pl-12")}>
          {item.warnings.map((warning, index) => (
            <li key={index} className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-400"><TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />{warning.message}</li>
          ))}
        </ul>
      )}

      {held && (
        <div className={cn("space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs", !compact && "sm:ml-12")}>
          <p role="status">
            <span className="font-medium">{platform} is already uploaded</span>
            {holderName && <> ({holderName})</>}.{" "}
            {compact ? "Choose what to do in the editor." : canReplace ? "Replace it with this file, or change this file's type." : "Change this file's type or platform, or remove the other upload."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {actions.includes("resolveInEditor") && <Link to={`/releases/${item.releaseId}/edit`} className={buttonVariants({ size: "xs" })}>Resolve in editor</Link>}
            {canReplace && onReplace && <Button type="button" size="xs" onClick={onReplace}><Replace />Replace {holderName ?? "it"}</Button>}
            {!compact && onMap && <FileMappingSelects name={item.name} kind={item.kind} os={item.os} onChange={onMap} />}
          </div>
        </div>
      )}

      {actions.includes("retry") && (
        <div className={cn(!compact && "sm:pl-12")}><Button type="button" size="sm" variant="outline" onClick={onRetry}><RefreshCw />Retry</Button></div>
      )}
    </li>
  )
}
