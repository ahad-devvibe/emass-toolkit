import type { UserRole } from "@/auth/auth.types"
import type { FileKind, OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { FileMapping, FileMappingChange, PublishJob, PublishStatus, ReleaseActor, ReviewContext, ReleaseDetail, ReleaseEventItem, ReleaseEventKind, ReleaseFileItem, ReleaseList, ReleaseSummary } from "./releases.model"
import type { ReleaseStatus } from "./releases.types"

// --- Wire shapes, exactly as server/src/services/releases/releases.presenter.ts sends them ---

export type ApiStatus = "DRAFT" | "IN_REVIEW" | "CHANGES_REQUESTED" | "PUBLISHED" | "ARCHIVED" | "ROLLED_BACK"
export type ApiKind = "SDK" | "DOC"
export type ApiPlatform = "WINDOWS" | "MACOS" | "UBUNTU"
type ApiEventType = "CREATED" | "SUBMITTED" | "WITHDRAWN" | "CHANGES_REQUESTED" | "PUBLISHED" | "ARCHIVED" | "ROLLED_BACK" | "RESTORED" | "NOTES_EDITED"

type ApiActor = { id: string; name: string; role: UserRole }
export type ApiFile = { id: string; kind: ApiKind | null; platform: ApiPlatform | null; name: string; contentType: string; sizeBytes: number; sha256: string; createdAt: string }
type ApiEvent = { id: string; type: ApiEventType; actor: ApiActor; note: string | null; createdAt: string }

export type ApiReleaseSummary = {
  id: string
  product: { id: string; name: string }
  version: string
  status: ApiStatus
  createdBy: ApiActor
  createdAt: string
  updatedAt: string
  fileCount: number
  totalBytes: number
}

export type ApiReleaseDetail = ApiReleaseSummary & {
  releaseNotes: string
  publishedAt: string | null
  publishedBy: ApiActor | null
  files: ApiFile[]
  events: ApiEvent[]
  review?: ReviewContext
}

export type ApiPublishStatus = { job: PublishJob | null; status: ApiStatus }

export type ApiReleaseList = { releases: ApiReleaseSummary[]; nextCursor: string | null; counts: Record<ApiStatus, number> }

// --- Enum translation, both ways ---

const statusFromApi: Record<ApiStatus, ReleaseStatus> = {
  DRAFT: "draft",
  IN_REVIEW: "in_review",
  CHANGES_REQUESTED: "changes_requested",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  ROLLED_BACK: "rolled_back",
}

const kindFromApi: Record<ApiKind, FileKind> = { SDK: "sdk", DOC: "documentation" }

// No architecture: one build per platform, and Linux ships as the Ubuntu package
const osFromApi: Record<ApiPlatform, OperatingSystem> = { WINDOWS: "windows", MACOS: "macos", UBUNTU: "linux" }

const invert = <K extends string, V extends string>(map: Record<K, V>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key])) as Record<V, K>

const statusToApi = invert(statusFromApi)
const kindToApi = invert(kindFromApi)
const osToApi = invert(osFromApi)

export const toApiStatus = (status: ReleaseStatus): ApiStatus => statusToApi[status]
export const toApiKind = (kind: FileKind): ApiKind => kindToApi[kind]
export const toApiPlatform = (os: OperatingSystem): ApiPlatform => osToApi[os]

/** Upload fields for a file: only what's known, and docs never carry a platform. */
export function toApiMapping({ kind, os }: FileMapping): { kind?: ApiKind; platform?: ApiPlatform } {
  if (!kind) return {}
  if (kind === "documentation" || !os) return { kind: toApiKind(kind) }
  return { kind: toApiKind(kind), platform: toApiPlatform(os) }
}

/** One entry of PATCH /releases/:id `files`: null kind or platform is sent as null. */
export function toApiFileMapping({ id, kind, os }: FileMappingChange): { id: string; kind: ApiKind | null; platform: ApiPlatform | null } {
  return { id, kind: kind ? toApiKind(kind) : null, platform: kind === "sdk" && os ? toApiPlatform(os) : null }
}

export const fromApiPlatform = (platform: ApiPlatform): OperatingSystem => osFromApi[platform]

// --- Responses ---

const toActor = (actor: ApiActor): ReleaseActor => ({ id: actor.id, name: actor.name, role: actor.role })

export function toReleaseFile(file: ApiFile): ReleaseFileItem {
  const kind = file.kind ? kindFromApi[file.kind] : null
  return {
    id: file.id,
    name: file.name,
    kind,
    os: kind === "sdk" && file.platform ? osFromApi[file.platform] : null,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    createdAt: file.createdAt,
  }
}

const toEvent = (event: ApiEvent): ReleaseEventItem => ({
  id: event.id,
  type: event.type.toLowerCase() as ReleaseEventKind,
  actor: toActor(event.actor),
  note: event.note,
  at: event.createdAt,
})

export function toReleaseSummary(release: ApiReleaseSummary): ReleaseSummary {
  return {
    id: release.id,
    product: { id: release.product.id, name: release.product.name },
    version: release.version,
    status: statusFromApi[release.status],
    createdBy: toActor(release.createdBy),
    createdAt: release.createdAt,
    updatedAt: release.updatedAt,
    fileCount: release.fileCount,
    totalBytes: release.totalBytes,
  }
}

export function toReleaseDetail(release: ApiReleaseDetail): ReleaseDetail {
  return {
    ...toReleaseSummary(release),
    releaseNotes: release.releaseNotes,
    publishedAt: release.publishedAt,
    publishedBy: release.publishedBy && toActor(release.publishedBy),
    files: release.files.map(toReleaseFile),
    events: release.events.map(toEvent),
    review: { currentPublished: release.review?.currentPublished ?? null, restoreTarget: release.review?.restoreTarget ?? null },
  }
}

export function toPublishStatus(status: ApiPublishStatus): PublishStatus {
  return { job: status.job, status: statusFromApi[status.status] }
}

export function toReleaseList(list: ApiReleaseList): ReleaseList {
  const counts = Object.fromEntries(Object.values(statusFromApi).map((status) => [status, 0])) as Record<ReleaseStatus, number>
  for (const [status, count] of Object.entries(list.counts) as [ApiStatus, number][]) {
    if (status in statusFromApi) counts[statusFromApi[status]] = count
  }
  return { releases: list.releases.map(toReleaseSummary), nextCursor: list.nextCursor, counts }
}
