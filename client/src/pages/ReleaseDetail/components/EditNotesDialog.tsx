import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NotesEditor } from "@/pages/ReleaseEditor/components/NotesEditor"

type EditNotesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  version: string
  notes: string
  /** Resolve true to close; false keeps the dialog open (the caller reported the error). */
  onSave: (notes: string) => Promise<boolean>
}

/** Release notes are the one thing that can still change after publish. */
export function EditNotesDialog({ open, onOpenChange, version, notes, onSave }: EditNotesDialogProps) {
  // Mounted fresh on each open (see the caller's key), so the draft starts from the saved notes
  const [draft, setDraft] = useState(notes)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    const closed = await onSave(draft)
    setSaving(false)
    if (closed) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-3xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>Edit notes for v{version}</DialogTitle>
          <DialogDescription>Customers see the change right away, and it's logged in the activity.</DialogDescription>
        </DialogHeader>
        <NotesEditor value={draft} onChange={setDraft} />
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={saving || draft === notes} onClick={() => void save()}>{saving && <Loader2 className="animate-spin" />}Save notes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
