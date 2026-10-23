import { useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { authErrorMessage } from "@/auth/auth.messages"
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

// Lets another page send the user here with the email filled in and a notice
type SignInState = { email?: string; notice?: string } | null

export function SignInPage() {
  const { signIn } = useAuth()
  const location = useLocation()
  const initial = location.state as SignInState
  const [email, setEmail] = useState(initial?.email ?? "")
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState("")
  const [notice, setNotice] = useState(initial?.notice ?? "")
  const [submitting, setSubmitting] = useState(false)
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
    } finally {
      setSubmitting(false)
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
        {formError && <FormAlert>{formError}</FormAlert>}
        <FormField id="email" label="Work email" error={fieldErrors.email}>
          <Input {...fieldA11y("email", fieldErrors.email)} type="email" autoComplete="email" placeholder="you@company.com" className="h-10" value={email} onChange={(event) => setEmail(event.target.value)} />
        </FormField>
        <FormField id="password" label="Password" error={fieldErrors.password} labelAside={<Link to="/forgot-password" state={{ email: email.trim() }} className="text-sm font-medium text-primary hover:underline">Forgot password?</Link>}>
          <PasswordInput {...fieldA11y("password", fieldErrors.password)} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Signing in…" : "Sign in"}</Button>
      </form>
    </AuthCard>
  )
}
