import { beforeEach, describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import { blockedFiles, fileBlockedReasons, highestShipped, platformTakenBy, unconfirmedWarnings } from "./releases.errors"

// The session module opens a BroadcastChannel at import; the API module only needs its two calls
const session = vi.hoisted(() => ({ authorizedRequest: vi.fn(), authorizedUpload: vi.fn() }))
vi.mock("@/auth/session", () => session)

const { listQuery, releasesApi } = await import("./releases.api")

beforeEach(() => {
  session.authorizedRequest.mockReset()
  session.authorizedUpload.mockReset()
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

describe("releasesApi.uploadFile", () => {
  const file = new File(["x"], "emass.deb")
  const apiFile = { id: "f1", kind: "SDK", platform: "UBUNTU", name: "emass.deb", contentType: "application/octet-stream", sizeBytes: 1, sha256: "a", createdAt: "2026-10-22T00:00:00.000Z" }

  it("sends kind, platform, replace and sha256, in that order, before the file", async () => {
    session.authorizedUpload.mockResolvedValue({ file: apiFile })

    const uploaded = await releasesApi.uploadFile("r/1", { file, kind: "sdk", os: "linux", replace: "old", sha256: "h" })

    expect(session.authorizedUpload).toHaveBeenCalledWith("/releases/r%2F1/files", [["kind", "SDK"], ["platform", "UBUNTU"], ["replace", "old"], ["sha256", "h"]], file, {})
    expect(uploaded).toMatchObject({ id: "f1", kind: "sdk", os: "linux" })
  })

  it("sends no platform for a doc", async () => {
    session.authorizedUpload.mockResolvedValue({ file: { ...apiFile, kind: "DOC", platform: null } })
    await releasesApi.uploadFile("r1", { file, kind: "documentation", os: null, sha256: "h" })
    expect(session.authorizedUpload.mock.calls[0][1]).toEqual([["kind", "DOC"], ["sha256", "h"]])
  })

  it("sends no fields for an undetected file", async () => {
    session.authorizedUpload.mockResolvedValue({ file: { ...apiFile, kind: null, platform: null } })
    const uploaded = await releasesApi.uploadFile("r1", { file, kind: null, os: null, sha256: "h" })
    expect(session.authorizedUpload.mock.calls[0][1]).toEqual([["sha256", "h"]])
    expect(uploaded.kind).toBeNull()
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
