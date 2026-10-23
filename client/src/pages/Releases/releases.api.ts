import { authorizedRequest, authorizedUpload } from "@/auth/session"
import type { UploadOptions } from "@/lib/api/upload"
import type { OperatingSystem, FileKind } from "@/pages/Catalog/catalog.types"
import type { FileMappingChange, ProductOption, PublishJob, PublishStatus, ReleaseDetail, ReleaseFileItem, ReleaseFilters, ReleaseList, VersionSuggestion } from "./releases.model"
import { type ApiFile, type ApiPublishStatus, type ApiReleaseDetail, type ApiReleaseList, toApiFileMapping, toPublishStatus, toApiMapping, toApiStatus, toReleaseDetail, toReleaseFile, toReleaseList } from "./releases.mappers"

export const RELEASES_PAGE_SIZE = 50

const releasePath = (id: string) => `/releases/${encodeURIComponent(id)}`
const filePath = (id: string, fileId: string) => `${releasePath(id)}/files/${encodeURIComponent(fileId)}`

/** Query string for GET /releases: status in the server's vocabulary, blanks dropped. */
export function listQuery({ statuses, productId, q, cursor, limit = RELEASES_PAGE_SIZE }: ReleaseFilters = {}): URLSearchParams {
  const params = new URLSearchParams({ limit: String(limit) })
  if (statuses?.length) params.set("status", statuses.map(toApiStatus).join(","))
  if (productId) params.set("productId", productId)
  if (q?.trim()) params.set("q", q.trim())
  if (cursor) params.set("cursor", cursor)
  return params
}

// kind is null for a file whose type wasn't detected: it uploads unmapped
export type UploadInput = { file: File; kind: FileKind | null; os: OperatingSystem | null; replace?: string }

/** Save draft: version, notes and file type/platform mappings, all optional. */
export type ReleaseUpdate = { version?: string; releaseNotes?: string; files?: FileMappingChange[] }

// Staff endpoints; the server enforces roles and creator-only changes
export const releasesApi = {
  list: async (filters: ReleaseFilters = {}): Promise<ReleaseList> => toReleaseList(await authorizedRequest<ApiReleaseList>(`/releases?${listQuery(filters)}`)),
  get: async (id: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(releasePath(id))),
  nextVersion: (productId: string) => authorizedRequest<VersionSuggestion>(`/releases/next-version?${new URLSearchParams({ productId })}`),
  create: async (input: { productId: string; version: string; releaseNotes?: string }): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>("/releases", { method: "POST", body: input })),
  update: async (id: string, { files, ...rest }: ReleaseUpdate): Promise<ReleaseDetail> => {
    const body = { ...rest, ...(files?.length && { files: files.map(toApiFileMapping) }) }
    return toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(releasePath(id), { method: "PATCH", body }))
  },
  submit: async (id: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/submit`, { method: "POST" })),
  withdraw: async (id: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/withdraw`, { method: "POST" })),
  remove: (id: string) => authorizedRequest<void>(releasePath(id), { method: "DELETE" }),

  /** Notes on a published release (creating DEV or admin); each real edit is logged. */
  updateNotes: async (id: string, releaseNotes: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/notes`, { method: "PATCH", body: { releaseNotes } })),

  // Admin review
  requestChanges: async (id: string, note: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/request-changes`, { method: "POST", body: { note } })),
  rollback: async (id: string, reason: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/rollback`, { method: "POST", body: { reason } })),
  /** Starts the background publish (202); poll publishStatus for progress. */
  publish: async (id: string): Promise<PublishJob> => (await authorizedRequest<{ job: PublishJob }>(`${releasePath(id)}/publish`, { method: "POST" })).job,
  publishStatus: async (id: string): Promise<PublishStatus> => toPublishStatus(await authorizedRequest<ApiPublishStatus>(`${releasePath(id)}/publish-status`)),

  /** Streams one file; known fields go first, in the order the server reads them. */
  uploadFile: async (id: string, { file, kind, os, replace }: UploadInput, options: UploadOptions = {}): Promise<ReleaseFileItem> => {
    const { kind: apiKind, platform } = toApiMapping({ kind, os })
    const fields: [string, string][] = []
    if (apiKind) fields.push(["kind", apiKind])
    if (platform) fields.push(["platform", platform])
    if (replace) fields.push(["replace", replace])
    const { file: uploaded } = await authorizedUpload<{ file: ApiFile }>(`${releasePath(id)}/files`, fields, file, options)
    return toReleaseFile(uploaded)
  },
  removeFile: (id: string, fileId: string) => authorizedRequest<void>(filePath(id, fileId), { method: "DELETE" }),
}

export const productsApi = {
  list: async (): Promise<ProductOption[]> => (await authorizedRequest<{ products: ProductOption[] }>("/products")).products,
}
