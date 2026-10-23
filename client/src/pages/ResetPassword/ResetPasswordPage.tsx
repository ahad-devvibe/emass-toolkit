import { useEffect, useState } from "react"
import { CheckCircle2, Link2Off, Loader2 } from "lucide-react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { authApi } from "@/auth/auth.api"
import { authErrorMessage, errorCode } from "@/auth/auth.messages"
import { useAuth } from "@/auth/useAuth"
import { AuthCard } from "@/components/common/AuthCard"
import { NewPasswordForm } from "@/components/common/NewPasswordForm"
import { Button } from "@/components/ui/button"

type View = { kind: "checking" } | { kind: "invalid"; message: string } | { kind: "ready"; email: string } | { kind: "done"; email: string }

const MISSING_TOKEN = "This reset link is incomplete. Open the link from the email again, or request a new one."

/** Opened from the reset email: checks the link, then sets the new password. */
export function ResetPasswordPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, signOut } = useAuth()
  // Read once, then dropped from the address bar so it stays out of history and Referer headers
  const [token] = useState(() => new URLSearchParams(location.search).get("token")?.trim() ?? "")
  const [view, setView] = useState<View>(() => (token ? { kind: "checking" } : { kind: "invalid", message: MISSING_TOKEN }))

  useEffect(() => {
    if (location.search) navigate(location.pathname, { replace: true })
  }, [location.pathname, location.search, navigate])

  useEffect(() => {
    if (!token) return
    let cancelled = false
    authApi.checkResetLink(token).then(
      ({ email }) => !cancelled && setView({ kind: "ready", email }),
      (error: unknown) => !cancelled && setView({ kind: "invalid", message: authErrorMessage(error) }),
    )
    return () => {
      cancelled = true
    }
  }, [token])

  async function submit(email: string, password: string) {
    try {
      await authApi.resetPassword(token, password)
    } catch (error) {
      // A link that expired or was used meanwhile can't be retried from this form
      if (errorCode(error)?.startsWith("RESET_LINK_")) return setView({ kind: "invalid", message: authErrorMessage(error) })
      throw error
    }
    // The reset signed every session out on the server; end this tab's too
    if (user) await signOut()
    setView({ kind: "done", email })
  }

  if (view.kind === "checking") {
    return (
      <AuthCard title="Reset your password">
        <p role="status" className="flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking your link…</p>
      </AuthCard>
    )
  }

  if (view.kind === "invalid") {
    return (
      <AuthCard title="Link can't be used" footer={<Link to="/sign-in" className="font-medium text-primary hover:underline">Back to sign in</Link>}>
        <div className="space-y-4 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"><Link2Off className="size-6" /></span>
          <p className="text-sm text-muted-foreground">{view.message}</p>
          <Button size="lg" className="w-full" render={<Link to="/forgot-password" />}>Request a new link</Button>
        </div>
      </AuthCard>
    )
  }

  if (view.kind === "done") {
    return (
      <AuthCard title="Password updated">
        <div className="space-y-4 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 className="size-6" /></span>
          <p className="text-sm text-muted-foreground">Sign in with your new password. For your security, you've been signed out on every device.</p>
          <Button size="lg" className="w-full" render={<Link to="/sign-in" state={{ email: view.email }} />}>Sign in</Button>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard title="Choose a new password" description={<>For <span className="font-medium">{view.email}</span></>}>
      <NewPasswordForm email={view.email} submitLabel="Update password" submittingLabel="Updating…" onSubmit={(password) => submit(view.email, password)} />
    </AuthCard>
  )
}
