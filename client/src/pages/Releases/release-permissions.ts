import type { UserRole } from "@/auth/auth.types"
import type { ManagedRelease } from "./releases.types"

export type ReleaseAction = "edit" | "submit" | "withdraw" | "delete" | "publish" | "reject" | "rollback"

// UI hint only: the server must enforce the same rules (AGENTS.md fixed decisions)
export function allowedActions(role: UserRole, release: ManagedRelease, canRollBack: boolean): ReleaseAction[] {
  if (role === "CUSTOMER") return []
  const isAdmin = role === "ADMIN"
  switch (release.status) {
    case "draft":
    case "changes_requested":
      return ["edit", "submit", "delete"]
    case "in_review":
      return isAdmin ? ["publish", "reject", "withdraw"] : ["withdraw"]
    case "published":
      return isAdmin && canRollBack ? ["rollback"] : []
    default:
      return []
  }
}

export function canCreateRelease(role: UserRole): boolean {
  return role === "DEV" || role === "ADMIN"
}
