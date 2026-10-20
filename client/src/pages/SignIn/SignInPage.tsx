import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { authApi } from "@/auth/auth.api"
import { authErrorMessage, errorCode } from "@/auth/auth.messages"
import { useAuth } from "@/auth/useAuth"
import { AuthCard } from "@/components/common/AuthCard"
import { FormAlert, FormField } from "@/components/common/FormField"
import { EMAIL_PATTERN, fieldA11y } from "@/components/common/form.utils"
import { PasswordInput } from "@/components/common/PasswordInput"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MfaStep } from "./components/MfaStep"

type FieldErrors = { email?: string; password?: string }

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!email.trim()) errors.email = "Email is required"
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid email address"
  if (!password) errors.password = "Password is required"
  return errors
}

// Set by the set-password page so the user lands here ready to sign in
type SignInState = { email?: string; notice?: string } | null

export function SignInPage() {
  const { signIn } = useAuth()
  const location = useLocation()
  const initial = location.state as SignInState
  const [email, setEmail] = useState(initial?.email ?? "")
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [errorKind, setErrorKind] = useState<string>()
  const [notice, setNotice] = useState(initial?.notice ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [mfaEmail, setMfaEmail] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const errors = validate(email, password)
    setFieldErrors(errors)
    setFormError("")
    setNotice("")
    if (errors.email || errors.password) return
    setSubmitting(true)
    try {
      const { mfaRequired } = await signIn(email.trim(), password)
      // Without MFA the user is now set and GuestOnly redirects
      if (mfaRequired) setMfaEmail(email.trim())
    } catch (error) {
      setFormError(authErrorMessage(error))
      setErrorKind(errorCode(error))
    } finally {
      setSubmitting(false)
    }
  }

  async function resendSetPassword() {
    setResending(true)
    try {
      await authApi.resendSetPassword(email.trim())
      setFormError("")
      setNotice(`We've sent a new set-password link to ${email.trim()}.`)
    } catch (error) {
      setFormError(authErrorMessage(error))
      setErrorKind(errorCode(error))
    } finally {
      setResending(false)
    }
  }

  if (mfaEmail) {
    return (
      <AuthCard title="Check your email" description={<>We sent a 6-digit code to <span className="font-medium text-foreground">{mfaEmail}</span>.</>}>
        <MfaStep email={mfaEmail} onCancel={() => { setMfaEmail(null); setPassword("") }} />
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Sign in" description="Use your work email to access your SDK downloads." footer={<>New to EMASS? <Link to="/sign-up" className="font-medium text-primary hover:underline">Request access</Link></>}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        {formError && (
          <FormAlert>
            {formError}
            {errorKind === "ACCOUNT_NOT_ACTIVE" && (
              <button type="button" className="mt-1 block font-medium underline underline-offset-2 disabled:opacity-60" disabled={resending} onClick={resendSetPassword}>{resending ? "Sending…" : "Email me a new link"}</button>
            )}
          </FormAlert>
        )}
        <FormField id="email" label="Work email" error={fieldErrors.email}>
          <Input {...fieldA11y("email", fieldErrors.email)} type="email" autoComplete="email" placeholder="you@company.com" className="h-10" value={email} onChange={(event) => setEmail(event.target.value)} />
        </FormField>
        <FormField id="password" label="Password" error={fieldErrors.password}>
          <PasswordInput {...fieldA11y("password", fieldErrors.password)} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Signing in…" : "Sign in"}</Button>
      </form>
    </AuthCard>
  )
}
