import type { ReactNode } from "react"
import { Trash2 } from "lucide-react"
import { ConfirmDialog, type ConfirmHandler } from "./ConfirmDialog"

type DeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What's being deleted, e.g. "v2.5.0" or "this file" → "Delete v2.5.0?" */
  itemName: string
  description?: ReactNode
  confirmLabel?: string
  onConfirm: ConfirmHandler
}

export function DeleteDialog({ itemName, description = "This can't be undone.", confirmLabel = "Delete", ...props }: DeleteDialogProps) {
  return <ConfirmDialog {...props} title={`Delete ${itemName}?`} description={description} confirmLabel={confirmLabel} tone="destructive" icon={Trash2} />
}
