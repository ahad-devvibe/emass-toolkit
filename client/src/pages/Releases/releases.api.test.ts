import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import { blockedFiles, fileBlockedReasons, highestShipped, platformTakenBy, unconfirmedWarnings } from "./releases.errors"

// The session module opens a BroadcastChannel at import; the API module only needs its two calls
const session = vi.hoisted(() => ({ authorizedRequest: vi.fn(), authorizedSend: vi.fn() }))
vi.mock("@/auth/session", () => session)

const { listQuery, releasesApi } = await import("./releases.api")

beforeEach(() => {
  session.authorizedRequest.mockReset()
  session.authorizedSend.mockReset()
})

describe("listQuery", () => {
  it("uses the server's status vocabulary and drops blanks", () => {
    expect(listQuery({ statuses: ["in_review"], productId: "p1", q: "  core ", cursor: "c1", limit: 10 }).toString()).toBe("limit=10&status=IN_REVIEW&productId=p1&q=core&cursor=c1")
    expect(listQuery({ q: "   ", cursor: null, statuses: [] }).toString()).toBe("limit=50")
  })

  it("joins several statuses with commas", () => {
    expect(listQuery({ statuses: ["archived", "rolled_back"] }).get("status")).toBe("ARCHIVED,ROLLED_BACK")
  })
})

describe("releasesApi.uploads", () => {
  const apiFile = { id: "f1", kind: "SDK", platform: "UBUNTU", name: "emass.deb", contentType: "application/octet-stream", sizeBytes: 1, sha256: "a", createdAt: "2026-10-22T00:00:00.000Z" }
  const opened = { uploadId: "u1", name: "emass.deb", size: 1, sha256: "h", partSize: 10, partsDone: 0 }

  it("opens a session with the file's details and its mapping in the server's vocabulary", async () => {
    session.authorizedRequest.mockResolvedValue(opened)

    const result = await releasesApi.uploads.create("r/1", { name: "emass.deb", size: 1, sha256: "h", contentType: "application/vnd.debian.binary-package", kind: "sdk", os: "linux", replace: "old" })

    expect(session.authorizedRequest).toHaveBeenCalledWith("/releases/r%2F1/uploads", {
      method: "POST",
      body: { name: "emass.deb", size: 1, sha256: "h", contentType: "application/vnd.debian.binary-package", kind: "SDK", platform: "UBUNTU", replace: "old" },
    })
    expect(result).toEqual(opened)
  })

  it("sends no platform for a doc and no mapping for an undetected file", async () => {
    session.authorizedRequest.mockResolvedValue(opened)
    await releasesApi.uploads.create("r1", { name: "a.pdf", size: 1, sha256: "h", kind: "documentation", os: null })
    await releasesApi.uploads.create("r1", { name: "a.bin", size: 1, sha256: "h", kind: null, os: null })
    expect(session.authorizedRequest.mock.calls[0][1].body).toEqual({ name: "a.pdf", size: 1, sha256: "h", kind: "DOC" })
    expect(session.authorizedRequest.mock.calls[1][1].body).toEqual({ name: "a.bin", size: 1, sha256: "h" })
  })

  it("puts a part as raw bytes, and maps the completed file", async () => {
    const part = new Blob(["abc"])
    const options = { onProgress: () => undefined }
    session.authorizedSend.mockResolvedValue({ ...opened, partsDone: 3 })
    await releasesApi.uploads.putPart("r1", "u/1", 3, part, options)
    expect(session.authorizedSend).toHaveBeenCalledWith("PUT", "/releases/r1/uploads/u%2F1/parts/3", part, options)

    session.authorizedRequest.mockResolvedValue({ file: apiFile })
    const saved = await releasesApi.uploads.complete("r1", "u1")
    expect(session.authorizedRequest).toHaveBeenCalledWith("/releases/r1/uploads/u1/complete", { method: "POST" })
    expect(saved).toMatchObject({ id: "f1", kind: "sdk", os: "linux" })
  })

  it("lists and cancels uploads", async () => {
    session.authorizedRequest.mockResolvedValue({ uploads: [opened] })
    expect(await releasesApi.uploads.list("r1")).toEqual([opened])
    session.authorizedRequest.mockResolvedValue(undefined)
    await releasesApi.uploads.abort("r1", "u1")
    expect(session.authorizedRequest).toHaveBeenLastCalledWith("/releases/r1/uploads/u1", { method: "DELETE" })
  })
})

describe("releasesApi.publishJobs", () => {
  it("reads every running publish job", async () => {
    const entry = { releaseId: "r1", version: "1.0.0", productName: "EMASS IDE", job: { phase: "copying" } }
    session.authorizedRequest.mockResolvedValue({ jobs: [entry] })
    expect(await releasesApi.publishJobs()).toEqual([entry])
    expect(session.authorizedRequest).toHaveBeenCalledWith("/releases/publish-jobs")
  })
})

describe("releasesApi.checkFile", () => {
  it("posts the file's name, size and ranges, and maps the verdict's warnings", async () => {
    session.authorizedRequest.mockResolvedValue({ status: "ALLOWED", format: "PDF", versions: [{ version: "1.4.0" }], warnings: [{ code: "DOC_VERSION_MISMATCH", message: "m", version: "1.4.0", match: { x: 1 } }] })

    const input = { name: "guide.pdf", size: 10, sha256: "h", ranges: [{ offset: 0, data: "AA==" }] }
    const result = await releasesApi.checkFile("r1", input)

    expect(session.authorizedRequest).toHaveBeenCalledWith("/releases/r1/files/check", { method: "POST", body: input })
    expect(result).toEqual({ status: "ALLOWED", format: "PDF", versions: [{ version: "1.4.0" }], warnings: [{ code: "DOC_VERSION_MISMATCH", message: "m", version: "1.4.0" }] })
  })

  it("passes a request for more bytes through", async () => {
    session.authorizedRequest.mockResolvedValue({ status: "NEED_BYTES", ranges: [{ offset: 0, length: 65536 }] })
    expect(await releasesApi.checkFile("r1", { name: "a", size: 1, ranges: [] })).toEqual({ status: "NEED_BYTES", ranges: [{ offset: 0, length: 65536 }] })
  })
})

describe("releasesApi.submit", () => {
  const detail = { id: "r1", product: { id: "p", name: "P" }, version: "1.0.0", status: "IN_REVIEW", createdBy: { id: "u", name: "U", role: "DEV" }, createdAt: "", updatedAt: "", fileCount: 0, totalBytes: 0, releaseNotes: "", publishedAt: null, publishedBy: null, files: [], events: [], review: { currentPublished: null, restoreTarget: null } }

  it("confirms warnings only when asked", async () => {
    session.authorizedRequest.mockResolvedValue(detail)
    await releasesApi.submit("r1")
    await releasesApi.submit("r1", { confirmWarnings: true })
    expect(session.authorizedRequest.mock.calls.map((call) => call[1])).toEqual([
      { method: "POST", body: {} },
      { method: "POST", body: { confirmWarnings: true } },
    ])
  })
})

describe("releasesApi.update", () => {
  const detail = { id: "r1", product: { id: "p", name: "P" }, version: "1.0.0", status: "DRAFT", createdBy: { id: "u", name: "U", role: "DEV" }, createdAt: "", updatedAt: "", fileCount: 0, totalBytes: 0, releaseNotes: "", publishedAt: null, publishedBy: null, files: [], events: [] }

  it("saves version, notes and mappings in one request", async () => {
    session.authorizedRequest.mockResolvedValue(detail)

    await releasesApi.update("r1", { releaseNotes: "Hi", files: [{ id: "f1", kind: "sdk", os: "macos" }, { id: "f2", kind: null, os: null }] })

    expect(session.authorizedRequest).toHaveBeenCalledWith("/releases/r1", {
      method: "PATCH",
      body: { releaseNotes: "Hi", files: [{ id: "f1", kind: "SDK", platform: "MACOS" }, { id: "f2", kind: null, platform: null }] },
    })
  })

  it("leaves files out when no mapping changed", async () => {
    session.authorizedRequest.mockResolvedValue(detail)
    await releasesApi.update("r1", { version: "1.0.1", files: [] })
    expect(session.authorizedRequest.mock.calls[0][1].body).toEqual({ version: "1.0.1" })
  })
})

describe("file rule errors", () => {
  it("reads why a file is blocked, and which files block or warn on submit", () => {
    const reason = { code: "VERSION_MISMATCH", message: "says 1.0.0", match: { a: 1 } }
    const blocked = new ApiRequestError(409, "FILE_BLOCKED", "x", {}, { reasons: [reason] })
    const submitBlocked = new ApiRequestError(409, "FILE_BLOCKED", "x", {}, { files: [{ fileId: "f1", name: "a.exe", reasons: [reason] }] })
    const warned = new ApiRequestError(409, "FILE_WARNINGS_UNCONFIRMED", "x", {}, { files: [{ fileId: "f2", name: "b.pdf", warnings: [{ code: "NO_VERSION", message: "none" }] }] })

    expect(fileBlockedReasons(blocked)).toEqual([{ code: "VERSION_MISMATCH", message: "says 1.0.0" }])
    expect(blockedFiles(submitBlocked)).toEqual([{ fileId: "f1", name: "a.exe", issues: [{ code: "VERSION_MISMATCH", message: "says 1.0.0" }] }])
    expect(unconfirmedWarnings(warned)).toEqual([{ fileId: "f2", name: "b.pdf", issues: [{ code: "NO_VERSION", message: "none" }] }])
    expect(unconfirmedWarnings(blocked)).toBeNull()
    expect(fileBlockedReasons(new Error("x"))).toBeNull()
  })
})

describe("error helpers", () => {
  it("reads PLATFORM_TAKEN's holder and VERSION_NOT_NEWER's version", () => {
    const taken = new ApiRequestError(409, "PLATFORM_TAKEN", "taken", {}, { fileId: "f9" })
    const older = new ApiRequestError(409, "VERSION_NOT_NEWER", "older", {}, { highestShipped: "2.5.0" })

    expect(platformTakenBy(taken)).toBe("f9")
    expect(highestShipped(older)).toBe("2.5.0")
    expect(platformTakenBy(older)).toBeNull()
    expect(highestShipped(new Error("x"))).toBeNull()
  })
})

describe("admin review calls", () => {
  const detail = { id: "r1", product: { id: "p", name: "P" }, version: "1.0.0", status: "CHANGES_REQUESTED", createdBy: { id: "u", name: "U", role: "DEV" }, createdAt: "", updatedAt: "", fileCount: 0, totalBytes: 0, releaseNotes: "", publishedAt: null, publishedBy: null, files: [], events: [], review: { currentPublished: null, restoreTarget: null } }
  const job = { phase: "copying", filesTotal: 2, filesDone: 0, percent: 0, error: null, startedAt: "", finishedAt: null }

  it("sends feedback and rollback reasons", async () => {
    session.authorizedRequest.mockResolvedValue(detail)

    const sent = await releasesApi.requestChanges("r1", "Missing macOS")
    await releasesApi.rollback("r1", { reason: "Crashes", customerMessage: "Use v0.9.0" })

    expect(session.authorizedRequest).toHaveBeenNthCalledWith(1, "/releases/r1/request-changes", { method: "POST", body: { note: "Missing macOS" } })
    expect(session.authorizedRequest).toHaveBeenNthCalledWith(2, "/releases/r1/rollback", { method: "POST", body: { reason: "Crashes", customerMessage: "Use v0.9.0" } })
    expect(sent.status).toBe("changes_requested")
  })

  it("starts a publish and reads its status", async () => {
    session.authorizedRequest.mockResolvedValueOnce({ job }).mockResolvedValueOnce({ job, status: "IN_REVIEW" })

    expect(await releasesApi.publish("r1")).toEqual(job)
    expect(await releasesApi.publishStatus("r1")).toEqual({ job, status: "in_review" })
    expect(session.authorizedRequest.mock.calls.map((call) => call[0])).toEqual(["/releases/r1/publish", "/releases/r1/publish-status"])
  })
})
