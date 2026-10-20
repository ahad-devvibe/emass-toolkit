import type { ReactNode } from "react"
import { Navigate, useLocation, type Location } from "react-router-dom"
import { PageLoader } from "@/components/common/PageLoader"
import { useAuth } from "./useAuth"

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === "loading") return <PageLoader label="Restoring your session" />
  if (!user) return <Navigate to="/sign-in" state={{ from: location }} replace />
  return children
}

/** For sign-in / sign-up pages: signed-in users go to their home instead. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, user } = useAuth()
  const location = useLocation()
  if (status === "loading") return <PageLoader className="min-h-0 flex-1 bg-transparent" />
  if (user) {
    const from = (location.state as { from?: Location } | null)?.from
    // "/" resolves to the role's home (RoleHome)
    return <Navigate to={from ? `${from.pathname}${from.search}${from.hash}` : "/"} replace />
  }
  return children
}
