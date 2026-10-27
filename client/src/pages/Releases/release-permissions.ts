import type { UserRole } from "@/auth/auth.types"
import type { ReleaseSummary } from "./releases.model"

export type ReleaseAction = "edit" | "submit" | "withdraw" | "delete" | "publish" | "reject" | "rollback" | "editNotes"

type Viewer = { id: string; role: UserRole }

// UI hint only: the server enforces the same rules (only the creating DEV
// changes a release; ADMIN reviews and publishes but never edits)
export function releaseActions(viewer: Viewer, release: Pick<ReleaseSummary, "status" | "createdBy">): ReleaseAction[] {
  if (viewer.role === "ADMIN") {
    if (release.status === "in_review") return ["publish", "reject"]
    if (release.status === "published") return ["editNotes", "rollback"]
    // Older versions customers can still download can be withdrawn too
    if (release.status === "archived") return ["rollback"]
    return []
  }
  if (viewer.role !== "DEV" || viewer.id !== release.createdBy.id) return []
  switch (release.status) {
    case "draft":
    case "changes_requested":
      return ["edit", "submit", "delete"]
    case "in_review":
      return ["withdraw"]
    // Published: only the notes can still change
    case "published":
      return ["editNotes"]
    default:
      return []
  }
}

/** True when the viewer may change the release (the creating DEV, while it's editable). */
export function canEditRelease(viewer: Viewer, release: Pick<ReleaseSummary, "status" | "createdBy">): boolean {
  return releaseActions(viewer, release).includes("edit")
}

export function canCreateRelease(role: UserRole): boolean {
  return role === "DEV"
}
