import { authApi } from "@/auth/auth.api"
import { useAuth } from "@/auth/useAuth"
import { OtpCodeForm } from "@/components/common/OtpCodeForm"

/** Second sign-in step for DEV / ADMIN: the emailed one-time code. */
export function MfaStep({ email, onCancel }: { email: string; onCancel: () => void }) {
  const { verifyMfa } = useAuth()
  return (
    <OtpCodeForm
      submitLabel="Verify and sign in"
      submittingLabel="Verifying…"
      onVerify={(code) => verifyMfa(email, code)}
      onResend={() => authApi.resendMfa(email)}
      onCancel={onCancel}
      cancelLabel="Use a different account"
    />
  )
}
