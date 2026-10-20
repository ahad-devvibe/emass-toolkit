import type { ReactNode } from "react"
import { CheckCircle2 } from "lucide-react"
import { ConfirmDialog, type ConfirmHandler } from "./ConfirmDialog"

type ApproveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  confirmLabel?: string
  onConfirm: ConfirmHandler
}

export function ApproveDialog({ confirmLabel = "Approve", ...props }: ApproveDialogProps) {
  return <ConfirmDialog {...props} confirmLabel={confirmLabel} tone="success" icon={CheckCircle2} />
}
