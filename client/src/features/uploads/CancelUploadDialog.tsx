import { XCircle } from "lucide-react"
import { ConfirmDialog } from "@/components/common/dialogs/ConfirmDialog"
import { formatBytes } from "@/pages/ProductDetails/release.utils"
import type { QueueItem } from "./uploads.state"

/**
 * "Cancel this upload?" for one row at a time. Cancelling discards what was
 * sent, so a big file would start from zero; the default is to keep going.
 */
export function CancelUploadDialog({ item, onClose, onConfirm }: { item: QueueItem | null; onClose: () => void; onConfirm: (localId: string) => void }) {
  return (
    <ConfirmDialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Cancel this upload?"
      description={
        item && (
          <>
            <span className="font-medium text-foreground">{item.name}</span> has {formatBytes(item.loaded)} of {formatBytes(item.sizeBytes)} uploaded. Cancelling discards it, and you'd upload the whole file again.
          </>
        )
      }
      cancelLabel="Keep uploading"
      confirmLabel="Cancel upload"
      tone="destructive"
      icon={XCircle}
      onConfirm={() => {
        if (item) onConfirm(item.localId)
      }}
    />
  )
}
