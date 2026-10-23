import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { authApi } from "./auth.api"
import { AuthContext } from "./auth.context"
import type { AuthStatus, SessionUser } from "./auth.types"
import { endSession, hasSessionHint, startSession, subscribe } from "./session"

type AuthState = { status: AuthStatus; user: SessionUser | null }

const anonymous: AuthState = { status: "anonymous", user: null }

export function AuthProvider({ children }: { children: ReactNode }) {
  // With no session hint there is nothing to restore, so skip the boot refresh
  const [state, setState] = useState<AuthState>(() => (hasSessionHint() ? { status: "loading", user: null } : anonymous))
  const statusRef = useRef(state.status)
  useEffect(() => {
    statusRef.current = state.status
  }, [state.status])

  // /me goes through authorizedRequest: an expired access cookie triggers the
  // single-flight refresh (StrictMode's double effect shares the same request)
  const loadUser = useCallback(async () => {
    try {
      setState({ status: "authenticated", user: await authApi.me() })
    } catch {
      setState(anonymous)
    }
  }, [])

  useEffect(() => {
    if (!hasSessionHint()) return
    authApi.me().then(
      (user) => setState({ status: "authenticated", user }),
      () => setState(anonymous),
    )
  }, [])

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === "signed-out") setState(anonymous)
        // Signed in from another tab: pick up the shared session
        else if (event.fromOtherTab && statusRef.current === "anonymous") void loadUser()
      }),
    [loadUser],
  )

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password)
    if (result.mfaRequired) return { mfaRequired: true }
    startSession()
    setState({ status: "authenticated", user: result.user })
    return { mfaRequired: false }
  }, [])

  const verifyMfa = useCallback(async (email: string, code: string) => {
    const result = await authApi.verifyMfa(email, code)
    startSession()
    setState({ status: "authenticated", user: result.user })
  }, [])

  const completeSignup = useCallback(async (email: string, code: string, password: string) => {
    const { user, signedIn } = await authApi.signupComplete(email, code, password)
    if (signedIn) {
      startSession()
      setState({ status: "authenticated", user })
    }
    return { signedIn }
  }, [])

  const signOut = useCallback(async () => {
    try {
      // The refresh cookie reaches /auth/logout, so the server revokes it
      await authApi.logout()
    } catch {
      // Offline or server down: still end the local session
    }
    endSession()
  }, [])

  return <AuthContext.Provider value={{ ...state, signIn, verifyMfa, completeSignup, signOut }}>{children}</AuthContext.Provider>
}
