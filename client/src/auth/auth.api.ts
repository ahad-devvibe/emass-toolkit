import { apiRequest } from "@/lib/api/http"
import type { SessionUser, SignupInput } from "./auth.types"
import { authorizedRequest } from "./session"

type LoginResponse = { mfaRequired: true } | { mfaRequired: false; user: SessionUser }
// signedIn: a company address is active and its cookies are set; a personal one awaits review
type SignupCompleteResponse = { user: SessionUser; signedIn: boolean }

// No token ever appears here: the server sets both as httpOnly cookies
export const authApi = {
  captcha: () => apiRequest<{ image: string }>("/auth/captcha"),
  // Signup: the form emails a code, the code is checked, then the password finishes the account
  signup: (input: SignupInput) => apiRequest<{ email: string }>("/auth/signup", { method: "POST", body: input }),
  signupVerify: (email: string, code: string) => apiRequest<void>("/auth/signup/verify", { method: "POST", body: { email, code } }),
  signupComplete: (email: string, code: string, password: string) => apiRequest<SignupCompleteResponse>("/auth/signup/complete", { method: "POST", body: { email, code, password } }),
  resendSignupCode: (email: string) => apiRequest<void>("/auth/resend-otp", { method: "POST", body: { email, purpose: "SIGNUP_VERIFY" } }),
  login: (email: string, password: string) => apiRequest<LoginResponse>("/auth/login", { method: "POST", body: { email, password } }),
  verifyMfa: (email: string, code: string) => apiRequest<{ user: SessionUser }>("/auth/verify-otp", { method: "POST", body: { email, code, purpose: "MFA_LOGIN" } }),
  resendMfa: (email: string) => apiRequest<void>("/auth/resend-otp", { method: "POST", body: { email, purpose: "MFA_LOGIN" } }),
  // Forgot password: the email always gets the same answer; the link's token sets the new password
  forgotPassword: (email: string) => apiRequest<void>("/auth/forgot-password", { method: "POST", body: { email } }),
  checkResetLink: (token: string) => apiRequest<{ email: string }>("/auth/reset-password/check", { method: "POST", body: { token } }),
  resetPassword: (token: string, newPassword: string) => apiRequest<void>("/auth/reset-password", { method: "POST", body: { token, newPassword } }),
  logout: () => apiRequest<void>("/auth/logout", { method: "POST" }),
  me: () => authorizedRequest<SessionUser>("/auth/me"),
}
