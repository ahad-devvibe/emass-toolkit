import { TriangleAlert } from "lucide-react"
import { ConfirmDialog } from "@/components/common/dialogs"
import type { FileIssues } from "../releases.model"

type SubmitWarningsDialogProps = {
  /** The files and warnings the server asked to confirm; null keeps it closed. */
  files: FileIssues[] | null
  onClose: () => void
  /** Submits with confirmWarnings; resolve true to close, false to stay open (error reported). */
  onConfirm: () => Promise<boolean>
}

/**
 * Asked before a release with file warnings goes to review (no version
 * anywhere, or a doc of another version). The server refuses the submit
 * until it's confirmed, and records what was confirmed in the release history.
 */
export function SubmitWarningsDialog({ files, onClose, onConfirm }: SubmitWarningsDialogProps) {
  return (
    <ConfirmDialog
      open={files !== null}
      onOpenChange={(open) => { if (!open) onClose() }}
      icon={TriangleAlert}
      title="Check these files before submitting"
      description="Submit at your own risk. The reviewer sees these warnings too."
      confirmLabel="Submit anyway"
      onConfirm={onConfirm}
    >
      <ul aria-label="Files with warnings" className="max-h-64 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm">
        {(files ?? []).map((file) => (
          <li key={file.fileId}>
            <p className="font-medium break-all">{file.name}</p>
            <ul className="mt-0.5 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
              {file.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}
            </ul>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  )
}
