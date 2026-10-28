// Mirrors the server's UserRole / UserStatus enums and the /api/auth/me user shape
export type UserRole = "CUSTOMER" | "DEV" | "ADMIN"

export type UserStatus = "PENDING_APPROVAL" | "PENDING_SET_PASSWORD" | "ACTIVE" | "BLOCKED"

export type SessionUser = {
  id: string
  email: string
  firstName: string
  middleName: string | null
  lastName: string
  country: string
  companyName: string
  jobTitle: string
  /** What they said at sign-up they'll use EMASS for; null for older accounts */
  useCase: string | null
  /** Company website, optional at sign-up (a full URL); null when not given */
  website: string | null
  emailVerified: boolean
  role: UserRole
  status: UserStatus
  createdAt: string
}

export type AuthStatus = "loading" | "authenticated" | "anonymous"

export type SignInResult = { mfaRequired: boolean }

export type CompleteSignupResult = { signedIn: boolean }

export type SignupInput = { email: string; firstName: string; middleName?: string; lastName: string; country: string; companyName: string; jobTitle: string; useCase: string; website?: string; captcha: string }

export const roleLabels: Record<UserRole, string> = { CUSTOMER: "Customer", DEV: "Developer", ADMIN: "Admin" }

export const homePath = (role: UserRole) => (role === "CUSTOMER" ? "/catalog" : role === "ADMIN" ? "/admin/dashboard" : "/releases")
