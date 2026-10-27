import { useId, useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { authErrorMessage } from "@/auth/auth.messages"
import { FormField } from "@/components/common/FormField"
import { fieldA11y } from "@/components/common/form.utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ApiRequestError } from "@/lib/api/http"
import { cn } from "@/lib/utils"
import { domainsApi, type DomainKind, type DomainPolicy } from "./domains.api"
import { kindLabels, normalizeDomainInput } from "./domains.utils"

const kindOptions: { kind: DomainKind; hint: string }[] = [
  { kind: "FREE_MAIL", hint: "Sign-ups wait for an admin's approval" },
  { kind: "COMPETITOR", hint: "Sign-ups are refused" },
]

type AddDomainDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (row: DomainPolicy) => void
  /** The rule selected when the dialog opens (the page's current tab). */
  initialKind: DomainKind
}

/** Mounted fresh on each open (the caller keys it), so the form always starts empty. */
export function AddDomainDialog({ open, onOpenChange, onAdded, initialKind }: AddDomainDialogProps) {
  const id = useId()
  const [value, setValue] = useState("")
  const [kind, setKind] = useState<DomainKind>(initialKind)
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const domain = normalizeDomainInput(value)
    if (!domain) return setError(value.trim() ? "Enter a domain like example.com" : "Enter a domain to add")
    setSaving(true)
    try {
      onAdded(await domainsApi.add(domain, kind))
      onOpenChange(false)
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? (caught.fieldErrors.domain?.[0] ?? authErrorMessage(caught)) : authErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-md" showCloseButton={!saving}>
        <form onSubmit={submit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Add email domain</DialogTitle>
            <DialogDescription>Applies to new sign-ups only. Existing accounts keep their status.</DialogDescription>
          </DialogHeader>

          <FormField id={id} label="Domain" error={error} hint="You can paste an email address; we keep the part after @.">
            <Input
              {...fieldA11y(id, error)}
              aria-describedby={error ? `${id}-error` : `${id}-hint`}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              maxLength={320}
              autoFocus
              value={value}
              onChange={(event) => { setValue(event.target.value); setError(undefined) }}
            />
          </FormField>

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">List</legend>
            {kindOptions.map((option) => (
              <label key={option.kind} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50", kind === option.kind && "border-primary bg-primary/5 hover:bg-primary/5")}>
                <input type="radio" name={`${id}-kind`} value={option.kind} checked={kind === option.kind} onChange={() => setKind(option.kind)} className="mt-0.5 size-4 accent-primary" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{kindLabels[option.kind]}</span>
                  <span className="text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="animate-spin" />}Add domain</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
