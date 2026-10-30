import type { UserRole } from "@/auth/auth.types"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { ReleaseStatus } from "./releases.types"

// The client's view of /api/releases. The UI keeps lowercase vocabulary
// (status, kind, os); releases.mappers.ts is the only place that knows the
// server's uppercase enums.

export type ReleaseEventKind = "created" | "submitted" | "withdrawn" | "changes_requested" | "published" | "archived" | "rolled_back" | "restored" | "notes_edited" | "customers_notified"

export type ReleaseActor = { id: string; name: string; role: UserRole }

// kind is null until someone picks the type (undetected uploads); os is null
// for docs and for SDKs still waiting for a platform. "linux" = the Ubuntu build
/**
 * Something the server's file rules say about a file, with the message to show
 * (the server owns the wording). Blocks stop submit; warnings need confirming.
 */
export type FileIssue = { code: string; message: string; version?: string; fields?: string[]; expected?: string }

/** What the server found inside the file: PE/DEB/PKG are installers, PDF/OTHER docs. */
export type FileFormat = "PE" | "DEB" | "PKG" | "PDF" | "OTHER"

export type ReleaseFileItem = {
  id: string
  name: string
  kind: FileKind | null
  os: OperatingSystem | null
  contentType: string
  sizeBytes: number
  sha256: string
  createdAt: string
  format: FileFormat | null
  detectedVersions: string[]
  blockedBy: FileIssue[]
  warnings: FileIssue[]
}

/** One file's issues, as submit reports them in FILE_BLOCKED / FILE_WARNINGS_UNCONFIRMED. */
export type FileIssues = { fileId: string; name: string; issues: FileIssue[] }

export type ReleaseEventItem = { id: string; type: ReleaseEventKind; actor: ReleaseActor; note: string | null; at: string }

export type ReleaseSummary = {
  id: string
  product: { id: string; name: string }
  /** Null while a draft has none yet; every release in review or shipped has one. */
  version: string | null
  status: ReleaseStatus
  createdBy: ReleaseActor
  createdAt: string
  updatedAt: string
  fileCount: number
  totalBytes: number
}

export type VersionRef = { id: string; version: string }

// What the admin's review actions would touch: the release a publish would
// archive (while in review) and the one a rollback would restore (while published)
export type ReviewContext = { currentPublished: VersionRef | null; restoreTarget: VersionRef | null }

export type ReleaseDetail = ReleaseSummary & {
  releaseNotes: string
  publishedAt: string | null
  publishedBy: ReleaseActor | null
  files: ReleaseFileItem[]
  events: ReleaseEventItem[]
  review: ReviewContext
}

export type PublishPhase = "copying" | "finalizing" | "done" | "failed"

// The server's background publish job (copy staging → release bucket, then publish)
export type PublishJob = {
  phase: PublishPhase
  filesTotal: number
  filesDone: number
  /** Size-weighted 0–100 across all files. */
  percent: number
  error: { code: string; message: string } | null
  startedAt: string
  finishedAt: string | null
}

// job is null when none is known: never started, or lost in a server restart
export type PublishStatus = { job: PublishJob | null; status: ReleaseStatus }

// counts has every status (zeros included), for the tab badges
/** needsYou: what waits for the viewer (an admin's reviews, a dev's own releases sent back), ignoring filters */
export type ReleaseList = { releases: ReleaseSummary[]; nextCursor: string | null; counts: Record<ReleaseStatus, number>; needsYou: number }

export type VersionSuggestion = { highestShipped: string | null; suggestions: { patch: string; minor: string; major: string } }

export type ProductOption = { id: string; name: string; description: string | null; imageUrl: string | null }

export type ReleaseFilters = { statuses?: ReleaseStatus[]; productId?: string; q?: string; cursor?: string | null; limit?: number }

export type FileMapping = { kind: FileKind | null; os: OperatingSystem | null }

/** One file's type/platform, saved with the draft. */
export type FileMappingChange = FileMapping & { id: string }

/** A platform claimed by several files, from a DUPLICATE_PLATFORM error. */
export type PlatformDuplicate = { os: OperatingSystem; fileIds: string[] }
