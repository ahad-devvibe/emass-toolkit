import type { UserRole } from "@/auth/auth.types"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"

// in_review is the AGENTS.md "staged" state; draft and changes_requested are staff-only
export type ReleaseStatus = "draft" | "in_review" | "changes_requested" | "published" | "archived" | "rolled_back"

// A file as staff see it: kind is null until detection or the uploader maps it
export type StagedFile = {
  name: string
  sizeBytes: number
  checksum: string
  kind: FileKind | null
  os?: OperatingSystem
  arch?: string
  title?: string
  format?: string
  autoDetected: boolean
}

export type ReleaseEventType = "created" | "updated" | "submitted" | "withdrawn" | "changes_requested" | "published" | "archived" | "rolled_back" | "restored"

export type Actor = { name: string; role: UserRole }

export type ReleaseEvent = { type: ReleaseEventType; actor: Actor; at: string; note?: string }

export type ManagedRelease = {
  id: string
  productId: string
  version: string
  status: ReleaseStatus
  files: StagedFile[]
  releaseNotes?: string
  createdBy: Actor
  updatedAt: string
  events: ReleaseEvent[]
}

export type ReleaseDraft = Pick<ManagedRelease, "productId" | "version" | "files" | "releaseNotes">
