import { useId, useState } from "react"
import { Loader2 } from "lucide-react"
import { authErrorMessage } from "@/auth/auth.messages"
import { FormAlert } from "@/components/common/FormField"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { License } from "@/pages/Catalog/catalog.api"

type LicenseDialogProps = {
  license: License | null
  onOpenChange: (open: boolean) => void
  /** Records the acceptance and starts the download; rejects to show the error here. */
  onAccept: () => Promise<void>
}

/** Shown once, before a customer's first download. Mounted fresh per open (the caller keys it). */
export function LicenseDialog({ license, onOpenChange, onAccept }: LicenseDialogProps) {
  const id = useId()
  const [agreed, setAgreed] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState("")

  async function accept() {
    setAccepting(true)
    setError("")
    try {
      await onAccept()
    } catch (caught) {
      setError(authErrorMessage(caught))
      setAccepting(false)
    }
  }

  return (
    <Dialog open={license !== null} onOpenChange={(next) => { if (!accepting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!accepting}>
        <DialogHeader>
          <DialogTitle>{license?.title ?? "Software licence"}</DialogTitle>
          <DialogDescription>Please read and accept these terms before your first download. You only need to do this once.</DialogDescription>
        </DialogHeader>
        {license && (
          <div tabIndex={0} aria-label="Licence terms" className="max-h-[50vh] space-y-4 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            {license.sections.map((section) => (
              <section key={section.heading}>
                <h3 className="font-semibold">{section.heading}</h3>
                <p className="mt-1 leading-6 text-muted-foreground">{section.body}</p>
              </section>
            ))}
            <p className="text-xs text-muted-foreground">Licence version {license.version}</p>
          </div>
        )}
        {error && <FormAlert>{error}</FormAlert>}
        <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox id={id} checked={agreed} onCheckedChange={(checked) => setAgreed(checked === true)} disabled={accepting} className="mt-0.5" />
          <span>I have read and agree to the {license?.title ?? "licence"}.</span>
        </label>
        <DialogFooter>
          <Button variant="outline" disabled={accepting} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!agreed || accepting} onClick={() => void accept()}>{accepting && <Loader2 className="animate-spin" />}Accept and download</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
