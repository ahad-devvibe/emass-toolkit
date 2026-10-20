import { useEffect, useState, type FormEvent } from "react"
import { Loader2 } from "lucide-react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { authApi } from "@/auth/auth.api"
import { authErrorMessage } from "@/auth/auth.messages"
import type { SetPasswordInvite } from "@/auth/auth.types"
import { AuthCard } from "@/components/common/AuthCard"
import { FormAlert, FormField } from "@/components/common/FormField"
import { EMAIL_PATTERN, fieldA11y } from "@/components/common/form.utils"
import { PasswordInput } from "@/components/common/PasswordInput"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

// Matches the server's setPasswordSchema
const MIN_LENGTH = 6
const MAX_LENGTH = 72

type InviteState = { kind: "loading" } | { kind: "ready"; invite: SetPasswordInvite } | { kind: "invalid"; message: string }

export function SetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get("token") ?? ""
  const [state, setState] = useState<InviteState>(token ? { kind: "loading" } : { kind: "invalid", message: "This link is missing its token. Open the link from the email again." })

  useEffect(() => {
    if (!token) return
    let active = true
    authApi.getSetPasswordInvite(token).then(
      (invite) => active && setState({ kind: "ready", invite }),
      (error) => active && setState({ kind: "invalid", message: authErrorMessage(error) }),
    )
    return () => {
      active = false
    }
  }, [token])

  if (state.kind === "loading") {
    return <AuthCard title="Set your password"><p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking your link…</p></AuthCard>
  }
  if (state.kind === "invalid") return <ExpiredLink message={state.message} />
  return <PasswordForm token={token} invite={state.invite} />
}

function PasswordForm({ token, invite }: { token: string; invite: SetPasswordInvite }) {
  const navigate = useNavigate()
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
      await authApi.setPassword(token, password)
      navigate("/sign-in", { replace: true, state: { email: invite.email, notice: "Your password is set. Sign in to continue." } })
    } catch (error) {
      setFormError(authErrorMessage(error))
      setSubmitting(false)
    }
  }

  return (
    <AuthCard title={`Welcome, ${invite.firstName}`} description={<>Choose a password for <span className="font-medium text-foreground">{invite.email}</span>.</>}>
      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {formError && <FormAlert>{formError}</FormAlert>}
        {/* Lets password managers save the pair against the right account */}
        <input type="email" name="email" autoComplete="username" value={invite.email} readOnly hidden />
        <FormField id="password" label="New password" error={errors.password} hint={`At least ${MIN_LENGTH} characters.`}>
          <PasswordInput {...fieldA11y("password", errors.password)} autoComplete="new-password" maxLength={MAX_LENGTH} autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
        </FormField>
        <FormField id="confirm" label="Confirm password" error={errors.confirm}>
          <PasswordInput {...fieldA11y("confirm", errors.confirm)} autoComplete="new-password" maxLength={MAX_LENGTH} value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Saving…" : "Set password"}</Button>
      </form>
    </AuthCard>
  )
}

function ExpiredLink({ message }: { message: string }) {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [formError, setFormError] = useState("")
  const [sentTo, setSentTo] = useState("")
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError("")
    if (!EMAIL_PATTERN.test(email.trim())) {
      setError("Enter the email you signed up with")
      return
    }
    setError("")
    setSubmitting(true)
    try {
      await authApi.resendSetPassword(email.trim())
      setSentTo(email.trim())
    } catch (caught) {
      setFormError(authErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthCard title="This link can't be used" description={message} footer={<Link to="/sign-in" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
      {sentTo ? (
        <FormAlert tone="success">If <span className="font-medium">{sentTo}</span> is waiting to set a password, a new link is on its way.</FormAlert>
      ) : (
        <form noValidate onSubmit={handleSubmit} className="space-y-4">
          {formError && <FormAlert>{formError}</FormAlert>}
          <FormField id="email" label="Email" error={error} hint="We'll send a fresh set-password link.">
            <Input {...fieldA11y("email", error)} type="email" autoComplete="email" placeholder="you@company.com" className="h-10" value={email} onChange={(event) => setEmail(event.target.value)} />
          </FormField>
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>{submitting && <Loader2 className="animate-spin" />}{submitting ? "Sending…" : "Send a new link"}</Button>
        </form>
      )}
    </AuthCard>
  )
}
