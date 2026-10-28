import { authorizedRequest, authorizedSend } from "@/auth/session"
import type { UploadOptions } from "@/lib/api/upload"
import type { OperatingSystem, FileKind } from "@/pages/Catalog/catalog.types"
import type { FileFormat, FileIssue, FileMappingChange, ProductOption, PublishJob, PublishStatus, ReleaseDetail, ReleaseFileItem, ReleaseFilters, ReleaseList, VersionSuggestion } from "./releases.model"
import { type ApiFile, type ApiFileIssue, type ApiPublishStatus, type ApiReleaseDetail, type ApiReleaseList, toApiFileMapping, toPublishStatus, toApiMapping, toApiStatus, toFileIssue, toReleaseDetail, toReleaseFile, toReleaseList } from "./releases.mappers"

export const RELEASES_PAGE_SIZE = 50

const releasePath = (id: string) => `/releases/${encodeURIComponent(id)}`
const filePath = (id: string, fileId: string) => `${releasePath(id)}/files/${encodeURIComponent(fileId)}`
const uploadPath = (id: string, uploadId: string) => `${releasePath(id)}/uploads/${encodeURIComponent(uploadId)}`

/** Query string for GET /releases: status in the server's vocabulary, blanks dropped. */
export function listQuery({ statuses, productId, q, cursor, limit = RELEASES_PAGE_SIZE }: ReleaseFilters = {}): URLSearchParams {
  const params = new URLSearchParams({ limit: String(limit) })
  if (statuses?.length) params.set("status", statuses.map(toApiStatus).join(","))
  if (productId) params.set("productId", productId)
  if (q?.trim()) params.set("q", q.trim())
  if (cursor) params.set("cursor", cursor)
  return params
}

// kind is null for a file whose type wasn't detected: it uploads unmapped.
// sha256 is what the browser hashed; the server checks it again at complete
export type UploadCreateInput = { name: string; size: number; sha256: string; contentType?: string; kind: FileKind | null; os: OperatingSystem | null; replace?: string }

/** An open resumable upload: send part partsDone + 1 next. */
export type UploadSession = { uploadId: string; name: string; size: number; sha256: string; partSize: number; partsDone: number }

/** A publish job with what the uploads panel needs to label it. */
export type PublishJobEntry = { releaseId: string; version: string; productName: string; job: PublishJob }

/** A byte range of the file, base64, as the server asked for it. */
export type FileRange = { offset: number; data: string }
export type FileCheckInput = { name: string; size: number; sha256?: string; replace?: string; ranges: FileRange[] }
/** The server's answer: more bytes, or the verdict (a block is a 409 FILE_BLOCKED). */
export type FileCheckResult =
  | { status: "NEED_BYTES"; ranges: { offset: number; length: number }[] }
  | { status: "NEED_HASH" | "ALLOWED"; format: FileFormat; versions: { version: string }[]; warnings: FileIssue[] }

type ApiFileCheckResult = FileCheckResult extends infer R ? (R extends { warnings: FileIssue[] } ? Omit<R, "warnings"> & { warnings: ApiFileIssue[] } : R) : never

/** Save draft: version, notes and file type/platform mappings, all optional. */
export type ReleaseUpdate = { version?: string; releaseNotes?: string; files?: FileMappingChange[] }

// Staff endpoints; the server enforces roles and creator-only changes
export const releasesApi = {
  list: async (filters: ReleaseFilters = {}): Promise<ReleaseList> => toReleaseList(await authorizedRequest<ApiReleaseList>(`/releases?${listQuery(filters)}`)),
  get: async (id: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(releasePath(id))),
  /** Staff, any release state: records the click and returns a time-limited link (short for unpublished files). */
  downloadFile: (id: string, fileId: string) => authorizedRequest<{ url: string; expiresAt: string; fileName: string }>(`${releasePath(id)}/files/${encodeURIComponent(fileId)}/download`, { method: "POST" }),
  nextVersion: (productId: string) => authorizedRequest<VersionSuggestion>(`/releases/next-version?${new URLSearchParams({ productId })}`),
  create: async (input: { productId: string; version: string; releaseNotes?: string }): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>("/releases", { method: "POST", body: input })),
  update: async (id: string, { files, ...rest }: ReleaseUpdate): Promise<ReleaseDetail> => {
    const body = { ...rest, ...(files?.length && { files: files.map(toApiFileMapping) }) }
    return toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(releasePath(id), { method: "PATCH", body }))
  },
  /** confirmWarnings: the developer saw the files' warnings and submits anyway. */
  submit: async (id: string, input: { confirmWarnings?: boolean } = {}): Promise<ReleaseDetail> =>
    toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/submit`, { method: "POST", body: input })),
  withdraw: async (id: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/withdraw`, { method: "POST" })),
  remove: (id: string) => authorizedRequest<void>(releasePath(id), { method: "DELETE" }),

  /** Notes on a published release (creating DEV or admin); each real edit is logged. */
  updateNotes: async (id: string, releaseNotes: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/notes`, { method: "PATCH", body: { releaseNotes } })),

  // Admin review
  requestChanges: async (id: string, note: string): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/request-changes`, { method: "POST", body: { note } })),
  /** `reason` is internal; `customerMessage` (optional) goes into the email to everyone who downloaded it. */
  rollback: async (id: string, input: { reason: string; customerMessage?: string }): Promise<ReleaseDetail> => toReleaseDetail(await authorizedRequest<ApiReleaseDetail>(`${releasePath(id)}/rollback`, { method: "POST", body: input })),
  /** Starts the background publish (202); poll publishStatus for progress. */
  publish: async (id: string): Promise<PublishJob> => (await authorizedRequest<{ job: PublishJob }>(`${releasePath(id)}/publish`, { method: "POST" })).job,
  publishStatus: async (id: string): Promise<PublishStatus> => toPublishStatus(await authorizedRequest<ApiPublishStatus>(`${releasePath(id)}/publish-status`)),
  /** Every publish job running or recently settled (admins). */
  publishJobs: async (): Promise<PublishJobEntry[]> => (await authorizedRequest<{ jobs: PublishJobEntry[] }>("/releases/publish-jobs")).jobs,

  /** The rules' verdict before upload; call again with the ranges it asks for. */
  checkFile: async (id: string, input: FileCheckInput): Promise<FileCheckResult> => {
    const result = await authorizedRequest<ApiFileCheckResult>(`${releasePath(id)}/files/check`, { method: "POST", body: input })
    return result.status === "NEED_BYTES" ? result : { ...result, warnings: result.warnings.map(toFileIssue) }
  },
  // Resumable uploads: open (or find) a session, send its parts in order, complete
  uploads: {
    create: async (id: string, { kind, os, replace, ...file }: UploadCreateInput): Promise<UploadSession> =>
      authorizedRequest<UploadSession>(`${releasePath(id)}/uploads`, { method: "POST", body: { ...file, ...toApiMapping({ kind, os }), ...(replace && { replace }) } }),
    list: async (id: string): Promise<UploadSession[]> => (await authorizedRequest<{ uploads: UploadSession[] }>(`${releasePath(id)}/uploads`)).uploads,
    putPart: (id: string, uploadId: string, n: number, part: Blob, options: UploadOptions = {}): Promise<UploadSession> => authorizedSend<UploadSession>("PUT", `${uploadPath(id, uploadId)}/parts/${n}`, part, options),
    complete: async (id: string, uploadId: string): Promise<ReleaseFileItem> => toReleaseFile((await authorizedRequest<{ file: ApiFile }>(`${uploadPath(id, uploadId)}/complete`, { method: "POST" })).file),
    abort: (id: string, uploadId: string) => authorizedRequest<void>(uploadPath(id, uploadId), { method: "DELETE" }),
  },
  removeFile: (id: string, fileId: string) => authorizedRequest<void>(filePath(id, fileId), { method: "DELETE" }),
}

export const productsApi = {
  list: async (): Promise<ProductOption[]> => (await authorizedRequest<{ products: ProductOption[] }>("/products")).products,
}
