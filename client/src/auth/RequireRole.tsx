import type { ReactNode } from "react"
import { Navigate } from "react-router-dom"
import { PageLoader } from "@/components/common/PageLoader"
import { homePath, type UserRole } from "./auth.types"
import { useAuth } from "./useAuth"

// UX only: hides pages a role can't use. The API must still reject the calls.
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { status, user } = useAuth()
  if (status === "loading") return <PageLoader />
  if (!user) return <Navigate to="/sign-in" replace />
  if (!roles.includes(user.role)) return <Navigate to={homePath(user.role)} replace />
  return children
}

export function RoleHome() {
  const { status, user } = useAuth()
  if (status === "loading") return <PageLoader />
  return <Navigate to={user ? homePath(user.role) : "/sign-in"} replace />
}
