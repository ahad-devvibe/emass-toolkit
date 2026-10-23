import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import { Loader2 } from "lucide-react"
import { authErrorMessage } from "@/auth/auth.messages"
import { FormAlert, FormField } from "@/components/common/FormField"
import { fieldA11y } from "@/components/common/form.utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const RESEND_COOLDOWN_S = 30

type OtpCodeFormProps = {
  submitLabel: string
  submittingLabel: string
  /** Rejects with the API error to show it; resolves when the step is done. */
  onVerify: (code: string) => Promise<void>
  onResend: () => Promise<void>
  onCancel: () => void
  cancelLabel: ReactNode
  /** Shown on arrival, e.g. a code that expired on a later step. */
  initialError?: string
}

/** The emailed 6-digit code: input, resend with a cooldown, and a way back. */
export function OtpCodeForm({ submitLabel, submittingLabel, onVerify, onResend, onCancel, cancelLabel, initialError = "" }: OtpCodeFormProps) {
  const [code, setCode] = useState("")
  const [fieldError, setFieldError] = useState("")
  const [formError, setFormError] = useState(initialError)
  const [notice, setNotice] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")
    setNotice("")
    if (!/^\d{6}$/.test(code)) {
      setFieldError("Enter the 6-digit code from the email")
      return
    }
    setFieldError("")
    setSubmitting(true)
    try {
      // On success the parent moves on (or GuestOnly redirects)
      await onVerify(code)
    } catch (error) {
      setFormError(authErrorMessage(error))
      setSubmitting(false)
    }
  }

  async function resend() {
    setFormError("")
    setNotice("")
    setCooldown(RESEND_COOLDOWN_S)
    try {
      await onResend()
      setCode("")
      setNotice("A new code is on its way. Earlier codes no longer work.")
    } catch (error) {
      setFormError(authErrorMessage(error))
      setCooldown(0)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      {notice && <FormAlert tone="success">{notice}</FormAlert>}
      {formError && <FormAlert>{formError}</FormAlert>}
      <FormField id="code" label="Verification code" error={fieldError} hint="The code expires after 10 minutes.">
        <Input {...fieldA11y("code", fieldError)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus placeholder="000000" className="h-11 text-center font-mono text-lg tracking-[0.5em]" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? submittingLabel : submitLabel}</Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onCancel}>{cancelLabel}</button>
        <button type="button" className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" disabled={cooldown > 0} onClick={resend}>{cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}</button>
      </div>
    </form>
  )
}
