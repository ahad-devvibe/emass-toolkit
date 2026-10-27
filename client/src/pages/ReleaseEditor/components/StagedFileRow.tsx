import { useState } from "react"
import { Ban, CircleAlert, Copy, FileQuestion, Trash2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { DeleteDialog } from "@/components/common/dialogs"
import { Button } from "@/components/ui/button"
import { fileKindMeta, osMeta } from "@/pages/Catalog/catalog.meta"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import { releasesApi } from "@/pages/Releases/releases.api"
import type { FileMapping, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import type { MappingProblem } from "../editor.state"
import { FileMappingSelects } from "./FileMappingSelects"

function problemText(problem: MappingProblem): string {
  if (problem.type === "needsType") return "Choose a type"
  if (problem.type === "needsPlatform") return "Choose a platform"
  return `${osMeta[problem.os].label} is also set on ${problem.others.join(", ")}`
}

type StagedFileRowProps = {
  releaseId: string
  file: ReleaseFileItem
  /** The mapping shown: saved value or the local edit. */
  mapping: FileMapping
  problem?: MappingProblem
  /** The server refused this row on the last save (duplicate platform). */
  rejected?: boolean
  onMap: (kind: FileKind | null, os: OperatingSystem | null) => void
  /** The file was deleted on the server: reload the release. */
  onRemoved: () => void
}

/**
 * A file already stored on the draft. Type and platform are local edits,
 * saved with Save draft; problems show inline as you go. Remove deletes the
 * stored object and the row straight away.
 */
export function StagedFileRow({ releaseId, file, mapping, problem, rejected, onMap, onRemoved }: StagedFileRowProps) {
  const [removing, setRemoving] = useState(false)
  const unsaved = mapping.kind !== file.kind || mapping.os !== file.os
  const Icon = mapping.kind === "sdk" && mapping.os ? osMeta[mapping.os].Icon : mapping.kind ? fileKindMeta[mapping.kind].Icon : FileQuestion
  const flagged = Boolean(problem) || rejected

  async function remove(): Promise<boolean> {
    try {
      await releasesApi.removeFile(releaseId, file.id)
      toast(`${file.name} removed`)
      onRemoved()
      return true
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : "Couldn't remove the file. Try again.")
      return false
    }
  }

  async function copyChecksum() {
    try {
      await navigator.clipboard.writeText(file.sha256)
      toast.success("SHA-256 copied to clipboard")
    } catch {
      toast.error("Clipboard access is unavailable in this browser")
    }
  }

  return (
    <li className={cn("space-y-3 px-4 py-3.5", flagged && "bg-amber-500/5")}>
      <div className="flex items-center gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/70", flagged && "bg-amber-500/10 text-amber-600 dark:text-amber-400")}><Icon aria-hidden className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm">
            <span className="truncate font-medium" title={file.name}>{file.name}</span>
            {unsaved && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-px text-[11px] font-medium text-primary">Unsaved</span>}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{formatBytes(file.sizeBytes)}</span>
            <span aria-hidden>·</span>
            <button type="button" onClick={copyChecksum} title={`SHA-256 ${file.sha256} (click to copy)`} className="inline-flex items-center gap-1 rounded font-mono outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              sha256:{file.sha256.slice(0, 10)}<Copy aria-hidden className="size-3" />
            </button>
          </p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${file.name}`} onClick={() => setRemoving(true)}><Trash2 /></Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:pl-12">
        <FileMappingSelects name={file.name} kind={mapping.kind} os={mapping.os} onChange={onMap} />
        {(problem || rejected) && (
          <p role="status" className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <CircleAlert aria-hidden className="size-3.5 shrink-0" />
            {problem ? problemText(problem) : "The server refused this platform. Each platform can have one SDK."}
          </p>
        )}
      </div>
      {file.blockedBy.length > 0 && (
        <ul aria-label={`Why ${file.name} can't be submitted`} className="space-y-1 sm:pl-12">
          {file.blockedBy.map((reason, index) => (
            <li key={index} className="flex items-start gap-1.5 text-xs text-destructive">
              <Ban aria-hidden className="mt-px size-3.5 shrink-0" />
              {reason.message} Change the version, or remove this file.
            </li>
          ))}
        </ul>
      )}
      {file.warnings.length > 0 && (
        <ul aria-label={`Warnings for ${file.name}`} className="space-y-1 sm:pl-12">
          {file.warnings.map((warning, index) => (
            <li key={index} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <TriangleAlert aria-hidden className="mt-px size-3.5 shrink-0" />
              {warning.message}
            </li>
          ))}
        </ul>
      )}
      <DeleteDialog open={removing} onOpenChange={setRemoving} itemName={file.name} description="The uploaded file is deleted from storage. You can upload it again later." confirmLabel="Remove" onConfirm={remove} />
    </li>
  )
}
