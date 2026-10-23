import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { authErrorMessage } from "@/auth/auth.messages"
import { FormAlert, FormField } from "@/components/common/FormField"
import { fieldA11y } from "@/components/common/form.utils"
import { PasswordInput } from "@/components/common/PasswordInput"
import { Button } from "@/components/ui/button"

// Matches the server's password rules
const MIN_LENGTH = 6
const MAX_LENGTH = 72

type NewPasswordFormProps = {
  /** The account's email, so password managers save the pair against it. */
  email: string
  submitLabel: string
  submittingLabel: string
  /** Rejects with the API error to show it. */
  onSubmit: (password: string) => Promise<void>
}

/** Password + confirmation, checked against the server's length rules. */
export function NewPasswordForm({ email, submitLabel, submittingLabel, onSubmit }: NewPasswordFormProps) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next: typeof errors = {}
    if (password.length < MIN_LENGTH) next.password = `Use at least ${MIN_LENGTH} characters`
    else if (password.length > MAX_LENGTH) next.password = `Use ${MAX_LENGTH} characters or fewer`
    if (!next.password && confirm !== password) next.confirm = "Passwords don't match"
    setErrors(next)
    setFormError("")
    if (next.password || next.confirm) return
    setSubmitting(true)
    try {
      await onSubmit(password)
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-4">
      {formError && <FormAlert>{formError}</FormAlert>}
      <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
      <FormField id="password" label="Password" error={errors.password} hint={`At least ${MIN_LENGTH} characters.`}>
        <PasswordInput {...fieldA11y("password", errors.password)} autoComplete="new-password" maxLength={MAX_LENGTH} autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
      </FormField>
      <FormField id="confirm" label="Confirm password" error={errors.confirm}>
        <PasswordInput {...fieldA11y("confirm", errors.confirm)} autoComplete="new-password" maxLength={MAX_LENGTH} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </FormField>
      <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? submittingLabel : submitLabel}</Button>
    </form>
  )
}
