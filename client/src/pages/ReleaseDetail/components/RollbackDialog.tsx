import { useId, useState } from "react"
import { RotateCcw } from "lucide-react"
import { ConfirmDialog } from "@/components/common/dialogs"
import { FormField } from "@/components/common/FormField"
import { fieldA11y } from "@/components/common/form.utils"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { ReleaseDetail } from "@/pages/Releases/releases.model"

const REASON_MAX = 2000
const MESSAGE_MAX = 1000

export type RollbackInput = { reason: string; customerMessage?: string }

type RollbackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  release: ReleaseDetail
  /** Resolve true to close; false keeps the dialog open (the caller reported the error). */
  onConfirm: (input: RollbackInput) => Promise<boolean>
}

function Counter({ length, max }: { length: number; max: number }) {
  return <span className={cn("text-xs tabular-nums text-muted-foreground", length >= max && "text-destructive")}>{length}/{max}</span>
}

/** What happens to customers, by state: published (restore or nothing left) or archived (just withdrawn). */
function Outcome({ release }: { release: ReleaseDetail }) {
  const version = <span className="font-mono">v{release.version}</span>
  const { restoreTarget, currentPublished } = release.review
  if (release.status === "archived") {
    return <p>Customers can no longer download {version}.{currentPublished && <> The published version (<span className="font-mono">v{currentPublished.version}</span>) is unchanged.</>}</p>
  }
  return restoreTarget
    ? <p>Customers lose access to {version} and <span className="font-mono">v{restoreTarget.version}</span> becomes the published version again.</p>
    : <p>Customers lose access to {version}. There's no earlier version to restore, so {release.product.name} will have no published release.</p>
}

/** Mounted fresh per open (the caller keys it), so both fields start empty. */
export function RollbackDialog({ open, onOpenChange, release, onConfirm }: RollbackDialogProps) {
  const id = useId()
  const [reason, setReason] = useState("")
  const [message, setMessage] = useState("")
  const [showError, setShowError] = useState(false)
  const error = showError && !reason.trim() ? "A reason is required" : undefined

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="destructive"
      icon={RotateCcw}
      title={`Roll back v${release.version}?`}
      description={
        <div className="space-y-2">
          <Outcome release={release} />
          <p className="text-xs">Customers who downloaded <span className="font-mono">v{release.version}</span> will be emailed.</p>
        </div>
      }
      confirmLabel="Roll back"
      onConfirm={() => {
        if (!reason.trim()) {
          setShowError(true)
          return false
        }
        return onConfirm({ reason: reason.trim(), customerMessage: message.trim() || undefined })
      }}
    >
      <div className="space-y-4">
        <FormField id={`${id}-reason`} label="Internal reason" required error={error} hint="Kept in the release history. Customers never see it." labelAside={<Counter length={reason.length} max={REASON_MAX} />}>
          <Textarea {...fieldA11y(`${id}-reason`, error)} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={REASON_MAX} placeholder="What's wrong with this build?" className="max-h-48 min-h-20" autoFocus />
        </FormField>
        <FormField id={`${id}-message`} label="Message to customers" optional hint="Added to the email. Leave empty to send the standard notice." labelAside={<Counter length={message.length} max={MESSAGE_MAX} />}>
          <Textarea id={`${id}-message`} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={MESSAGE_MAX} placeholder="e.g. Please reinstall the previous version until a fix ships." className="max-h-48 min-h-20" />
        </FormField>
      </div>
    </ConfirmDialog>
  )
}
