import type { ReactNode } from "react"
import { Plus, UploadCloud } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFileDrop } from "../useFileDrop"

/**
 * The large drop area shown while a release has no files yet.
 * `disabledReason` turns it off and says why (e.g. no version yet).
 */
export function FileDropzone({ onFiles, disabledReason }: { onFiles: (files: File[]) => void; disabledReason?: string | null }) {
  const disabled = Boolean(disabledReason)
  const { dragging, dropProps, inputProps, open } = useFileDrop(onFiles, disabled)

  return (
    <div
      {...dropProps}
      aria-disabled={disabled || undefined}
      className={cn("flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors", dragging ? "border-primary bg-primary/5" : "border-border", disabled && "opacity-60")}
    >
      <span className={cn("grid size-10 place-items-center rounded-full bg-muted text-muted-foreground transition-colors", dragging && "bg-primary/10 text-primary")}><UploadCloud className="size-5" /></span>
      <p className="mt-3 text-sm font-medium">{disabled ? disabledReason : dragging ? "Drop to add files" : "Drag files here"}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">SDK packages and documents, up to 1 GB each. We detect the type and platform from each filename; you can change them below.</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" disabled={disabled} onClick={open}>Browse files</Button>
      <input {...inputProps} />
    </div>
  )
}

/** The compact "Add files" picker for a card that already lists files. */
export function AddFilesButton({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { inputProps, open } = useFileDrop(onFiles)
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={open}><Plus />Add files</Button>
      <input {...inputProps} />
    </>
  )
}

/**
 * Turns a whole card into a drop target once it lists files: a dashed
 * overlay appears while files are dragged over it.
 */
export function DropOverlayArea({ onFiles, children, className }: { onFiles: (files: File[]) => void; children: ReactNode; className?: string }) {
  const { dragging, dropProps } = useFileDrop(onFiles)
  return (
    <div {...dropProps} className={cn("relative", className)}>
      {children}
      {dragging && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-xl border-2 border-dashed border-primary bg-primary/5 backdrop-blur-[1px]">
          <p className="flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-sm font-medium text-primary shadow-sm"><UploadCloud className="size-4" />Drop to add files</p>
        </div>
      )}
    </div>
  )
}
