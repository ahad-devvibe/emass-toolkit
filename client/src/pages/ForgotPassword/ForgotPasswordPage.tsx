import { useEffect, useState, type FormEvent } from "react"
import { Loader2, MailCheck } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { authApi } from "@/auth/auth.api"
import { authErrorMessage } from "@/auth/auth.messages"
import { AuthCard } from "@/components/common/AuthCard"
import { FormAlert, FormField } from "@/components/common/FormField"
import { EMAIL_PATTERN, fieldA11y } from "@/components/common/form.utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Matches the server's quiet period between two reset emails
const RESEND_COOLDOWN_S = 60

const backToSignIn = <Link to="/sign-in" className="font-medium text-primary hover:underline">Back to sign in</Link>

/** Asks for the email; the answer is the same whether or not it has an account. */
export function ForgotPasswordPage() {
  const location = useLocation()
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "")
  const [fieldError, setFieldError] = useState("")
  const [formError, setFormError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = email.trim()
    setFormError("")
    if (!value) return setFieldError("Email is required")
    if (!EMAIL_PATTERN.test(value)) return setFieldError("Enter a valid email address")
    setFieldError("")
    setSubmitting(true)
    try {
      await authApi.forgotPassword(value)
      setSentTo(value)
    } catch (error) {
      setFormError(authErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  if (sentTo) return <CheckYourEmail email={sentTo} onChangeEmail={() => setSentTo(null)} />

  return (
    <AuthCard title="Reset your password" description="Enter your email and we'll send you a link to choose a new password." footer={backToSignIn}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        <FormField id="email" label="Email" error={fieldError}>
          <Input {...fieldA11y("email", fieldError)} type="email" autoComplete="email" autoFocus placeholder="you@company.com" className="h-10" value={email} onChange={(event) => setEmail(event.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Sending link…" : "Send reset link"}</Button>
      </form>
    </AuthCard>
  )
}

function CheckYourEmail({ email, onChangeEmail }: { email: string; onChangeEmail: () => void }) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function resend() {
    setNotice("")
    setError("")
    setCooldown(RESEND_COOLDOWN_S)
    try {
      await authApi.forgotPassword(email)
      setNotice("We've sent it again. Only the newest link works.")
    } catch (err) {
      setError(authErrorMessage(err))
      setCooldown(0)
    }
  }

  return (
    <AuthCard title="Check your email" footer={backToSignIn}>
      <div className="space-y-4 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><MailCheck className="size-6" /></span>
        <p className="text-sm text-muted-foreground">If an account exists for <span className="font-medium text-foreground">{email}</span>, we've sent a link to reset your password. It expires in 30 minutes and works once.</p>
        {notice && <FormAlert tone="success">{notice}</FormAlert>}
        {error && <FormAlert>{error}</FormAlert>}
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onChangeEmail}>Use a different email</button>
          <button type="button" className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" disabled={cooldown > 0} onClick={resend}>{cooldown > 0 ? `Send again in ${cooldown}s` : "Send again"}</button>
        </div>
      </div>
    </AuthCard>
  )
}
