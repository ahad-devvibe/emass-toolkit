import { createContext } from "react"
import type { AuthStatus, CompleteSignupResult, SessionUser, SignInResult } from "./auth.types"

export type AuthContextValue = {
  status: AuthStatus
  user: SessionUser | null
  signIn: (email: string, password: string) => Promise<SignInResult>
  verifyMfa: (email: string, code: string) => Promise<void>
  completeSignup: (email: string, code: string, password: string) => Promise<CompleteSignupResult>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
