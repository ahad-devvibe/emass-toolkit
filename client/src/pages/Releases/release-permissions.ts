import type { UserRole } from "@/auth/auth.types"
import type { ReleaseSummary } from "./releases.model"

export type ReleaseAction = "edit" | "delete" | "publish" | "rollback" | "editNotes"

type Viewer = { id: string; role: UserRole }

// UI hint only: the server enforces the same rules (any DEV manages any
// release; ADMIN can only read them)
export function releaseActions(viewer: Viewer, release: Pick<ReleaseSummary, "status">): ReleaseAction[] {
  if (viewer.role !== "DEV") return []
  switch (release.status) {
    case "draft":
      return ["publish", "edit", "delete"]
    // Published: only the notes can still change
    case "published":
      return ["editNotes", "rollback"]
    // Older versions customers can still download can be withdrawn too
    case "archived":
      return ["rollback"]
    default:
      return []
  }
}

/** True when the viewer may change the release (any DEV, while it's a draft). */
export function canEditRelease(viewer: Viewer, release: Pick<ReleaseSummary, "status">): boolean {
  return releaseActions(viewer, release).includes("edit")
}

export function canCreateRelease(role: UserRole): boolean {
  return role === "DEV"
}
