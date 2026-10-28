import { useRef, useState, type ChangeEvent } from "react"
import { FolderOpen, Play, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/common/dialogs/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { canPickWithHandles, pickFilesWithHandles, type PickedFile } from "./file-source"
import { useUploads, useUploadsStore } from "./useUploads"

/**
 * After a refresh: the uploads that couldn't carry on by themselves, with one
 * click for all of them. Chrome and Edge reopen them from their handles;
 * other browsers pick them again, all at once. Scoped to one release in its
 * editor, or every release in the panel.
 */
export function InterruptedNotice({ releaseId, className }: { releaseId?: string; className?: string }) {
  const store = useUploadsStore()
  const waiting = useUploads().items.filter((item) => item.status === "needsFile" && (!releaseId || item.releaseId === releaseId))
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)

  if (waiting.length === 0) return null
  const withHandle = waiting.some((item) => item.handle)
  const withoutHandle = waiting.some((item) => !item.handle)

  function resumePicked(picked: PickedFile[]) {
    const unmatched = store.resumeWithFiles(picked, releaseId)
    if (unmatched.length) toast.error(`${unmatched.join(", ")} ${unmatched.length === 1 ? "isn't one" : "aren't"} of the interrupted uploads`)
  }

  async function resumeAll() {
    setBusy(true)
    try {
      await store.resumeAll(releaseId)
    } finally {
      setBusy(false)
    }
  }

  async function pickFiles() {
    if (!canPickWithHandles()) {
      inputRef.current?.click()
      return
    }
    try {
      const picked = await pickFilesWithHandles()
      if (picked.length) resumePicked(picked)
    } catch {
      inputRef.current?.click()
    }
  }

  function picked(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    if (files.length) resumePicked(files.map((file) => ({ file, handle: null })))
    event.target.value = ""
  }

  const count = `${waiting.length} ${waiting.length === 1 ? "upload was" : "uploads were"}`
  return (
    <div role="status" className={cn("space-y-2 border-b bg-amber-500/10 px-3 py-2.5 text-xs", className)}>
      <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300"><RotateCcw aria-hidden className="size-3.5" />{count} interrupted by a refresh</p>
      <div className="flex flex-wrap gap-2">
        {withHandle && <Button type="button" size="xs" onClick={() => void resumeAll()} disabled={busy}><Play />Resume all</Button>}
        {withoutHandle && <Button type="button" size="xs" variant={withHandle ? "outline" : "default"} onClick={() => void pickFiles()} disabled={busy}><FolderOpen />Pick files</Button>}
        <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmCancel(true)} disabled={busy}>Cancel all</Button>
      </div>
      <input ref={inputRef} type="file" multiple hidden onChange={picked} />
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={`Cancel ${waiting.length === 1 ? "this upload" : `these ${waiting.length} uploads`}?`}
        description="What was already sent is discarded; you'd upload the files again from the start."
        cancelLabel="Keep them"
        confirmLabel="Cancel uploads"
        tone="destructive"
        onConfirm={() => store.cancelInterrupted(releaseId)}
      />
    </div>
  )
}
