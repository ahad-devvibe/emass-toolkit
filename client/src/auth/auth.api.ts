import { apiRequest } from "@/lib/api/http"
import type { SessionUser, SetPasswordInvite, SignupInput } from "./auth.types"
import { authorizedRequest } from "./session"

type LoginResponse = { mfaRequired: true } | { mfaRequired: false; accessToken: string; user: SessionUser }

// The refresh token never appears here: the server keeps it in an httpOnly cookie
export const authApi = {
  captcha: () => apiRequest<{ image: string }>("/auth/captcha"),
  signup: (input: SignupInput) => apiRequest<SessionUser>("/auth/signup", { method: "POST", body: input }),
  login: (email: string, password: string) => apiRequest<LoginResponse>("/auth/login", { method: "POST", body: { email, password } }),
  verifyMfa: (email: string, code: string) => apiRequest<{ accessToken: string; user: SessionUser }>("/auth/verify-otp", { method: "POST", body: { email, code, purpose: "MFA_LOGIN" } }),
  resendMfa: (email: string) => apiRequest<void>("/auth/resend-otp", { method: "POST", body: { email, purpose: "MFA_LOGIN" } }),
  getSetPasswordInvite: (token: string) => apiRequest<SetPasswordInvite>(`/auth/set-password/${encodeURIComponent(token)}`),
  setPassword: (token: string, password: string) => apiRequest<void>("/auth/set-password", { method: "POST", body: { token, password } }),
  resendSetPassword: (email: string) => apiRequest<void>("/auth/resend-set-password", { method: "POST", body: { email } }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),
  me: () => authorizedRequest<SessionUser>("/auth/me"),
}
