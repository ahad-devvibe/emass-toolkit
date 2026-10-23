import { CircleAlert, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

type SaveBarProps = {
  /** What's unsaved, e.g. "notes · 2 file types". */
  summary: string
  /** Shown when the last save was refused (e.g. a duplicate platform). */
  error: string | null
  uploading: boolean
  saving: boolean
  onDiscard: () => void
  onSave: () => void
}

/**
 * Sticks to the bottom of the editor while anything is unsaved, so the save
 * action is wherever the user is working. Uploads don't need it: files are
 * stored as soon as they finish.
 */
export function SaveBar({ summary, error, uploading, saving, onDiscard, onSave }: SaveBarProps) {
  return (
    <div role="region" aria-label="Unsaved changes" className="sticky bottom-4 z-30 animate-in fade-in slide-in-from-bottom-2">
      <div className="flex flex-col gap-3 rounded-xl border bg-card/95 px-4 py-3 shadow-lg backdrop-blur sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">Unsaved changes <span className="font-normal text-muted-foreground">· {summary}</span></p>
          {error
            ? <p role="alert" className="mt-0.5 flex items-center gap-1.5 text-xs text-destructive"><CircleAlert aria-hidden className="size-3.5 shrink-0" />{error}</p>
            : <p className="mt-0.5 text-xs text-muted-foreground">{uploading ? "Uploads keep going and are stored as they finish. " : ""}Save to keep types, platforms, version and notes.</p>}
        </div>
        <div className="flex gap-2 sm:shrink-0">
          <Button variant="ghost" onClick={onDiscard} disabled={saving} className="flex-1 sm:flex-none">Discard</Button>
          <Button onClick={onSave} disabled={saving} title={`Save draft (${isMac ? "⌘" : "Ctrl+"}S)`} className="flex-1 sm:flex-none">{saving && <Loader2 className="animate-spin" />}Save draft</Button>
        </div>
      </div>
    </div>
  )
}
