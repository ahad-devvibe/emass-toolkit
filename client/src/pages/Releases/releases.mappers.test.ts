import { describe, expect, it } from "vitest"
import { type ApiFile, type ApiReleaseDetail, toApiFileMapping, toApiKind, toApiMapping, toApiPlatform, toApiStatus, toReleaseDetail, toReleaseFile, toReleaseList } from "./releases.mappers"

const actor = { id: "u1", name: "Dana User", role: "DEV" as const }

const sdk: ApiFile = { id: "f1", kind: "SDK", platform: "UBUNTU", name: "emass.deb", contentType: "application/vnd.debian.binary-package", sizeBytes: 5_000_000_000, sha256: "a".repeat(64), createdAt: "2026-10-22T10:00:00.000Z" }
const doc: ApiFile = { ...sdk, id: "f2", kind: "DOC", platform: null, name: "guide.pdf", contentType: "application/pdf" }

const detail: ApiReleaseDetail = {
  id: "r1",
  product: { id: "p1", name: "EMASS Core SDK" },
  version: "2.5.0",
  status: "CHANGES_REQUESTED",
  createdBy: actor,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
  fileCount: 2,
  totalBytes: 5_000_001_024,
  releaseNotes: "## Fixes",
  publishedAt: null,
  publishedBy: null,
  files: [sdk, doc],
  events: [
    { id: "e1", type: "CREATED", actor, note: null, createdAt: "2026-10-20T10:00:00.000Z" },
    { id: "e2", type: "CHANGES_REQUESTED", actor: { ...actor, id: "a1", role: "ADMIN" }, note: "Missing macOS build", createdAt: "2026-10-21T10:00:00.000Z" },
  ],
}

describe("toReleaseDetail", () => {
  it("lowercases status, kinds, platforms and events", () => {
    const release = toReleaseDetail(detail)

    expect(release.status).toBe("changes_requested")
    expect(release.files).toEqual([
      expect.objectContaining({ id: "f1", kind: "sdk", os: "linux", sizeBytes: 5_000_000_000 }),
      expect.objectContaining({ id: "f2", kind: "documentation", os: null }),
    ])
    expect(release.events.map((event) => [event.type, event.note, event.at])).toEqual([
      ["created", null, "2026-10-20T10:00:00.000Z"],
      ["changes_requested", "Missing macOS build", "2026-10-21T10:00:00.000Z"],
    ])
    expect(release.events[1].actor.role).toBe("ADMIN")
    expect(release).toMatchObject({ releaseNotes: "## Fixes", publishedBy: null, fileCount: 2, product: { name: "EMASS Core SDK" } })
  })

  it("maps the review context, defaulting to nothing", () => {
    expect(toReleaseDetail(detail).review).toEqual({ currentPublished: null, restoreTarget: null })
    const withReview = { ...detail, review: { currentPublished: { id: "r0", version: "2.4.0" }, restoreTarget: null } }
    expect(toReleaseDetail(withReview).review.currentPublished).toEqual({ id: "r0", version: "2.4.0" })
  })

  it("never gives a doc a platform", () => {
    expect(toReleaseFile({ ...doc, platform: "WINDOWS" }).os).toBeNull()
  })
})

describe("toReleaseList", () => {
  it("fills every status count, zeros included", () => {
    const list = toReleaseList({ releases: [detail], nextCursor: "abc", counts: { DRAFT: 2, IN_REVIEW: 0, CHANGES_REQUESTED: 1, PUBLISHED: 1, ARCHIVED: 0, ROLLED_BACK: 0 } })

    expect(list.counts).toEqual({ draft: 2, in_review: 0, changes_requested: 1, published: 1, archived: 0, rolled_back: 0 })
    expect(list.nextCursor).toBe("abc")
    expect(list.releases[0]).not.toHaveProperty("files")
  })
})

describe("request mapping", () => {
  it("maps every client value back to the server's", () => {
    expect(toApiStatus("in_review")).toBe("IN_REVIEW")
    expect(toApiStatus("rolled_back")).toBe("ROLLED_BACK")
    expect(toApiKind("documentation")).toBe("DOC")
    expect(toApiPlatform("linux")).toBe("UBUNTU")
    expect(toApiPlatform("macos")).toBe("MACOS")
  })

  it("round-trips a platform", () => {
    expect(toReleaseFile({ ...sdk, platform: toApiPlatform("linux") }).os).toBe("linux")
  })

  it("sends a platform for SDKs only, and nothing for an unmapped upload", () => {
    expect(toApiMapping({ kind: "sdk", os: "windows" })).toEqual({ kind: "SDK", platform: "WINDOWS" })
    expect(toApiMapping({ kind: "documentation", os: "windows" })).toEqual({ kind: "DOC" })
    expect(toApiMapping({ kind: null, os: null })).toEqual({})
  })

  it("builds save-draft mappings with explicit nulls", () => {
    expect(toApiFileMapping({ id: "f1", kind: "sdk", os: "linux" })).toEqual({ id: "f1", kind: "SDK", platform: "UBUNTU" })
    expect(toApiFileMapping({ id: "f2", kind: "sdk", os: null })).toEqual({ id: "f2", kind: "SDK", platform: null })
    expect(toApiFileMapping({ id: "f3", kind: null, os: "windows" })).toEqual({ id: "f3", kind: null, platform: null })
  })

  it("reads an unmapped file", () => {
    expect(toReleaseFile({ ...sdk, kind: null, platform: null })).toMatchObject({ kind: null, os: null })
  })

  it("reads the file rules' verdicts, defaulting to none", () => {
    expect(toReleaseFile(sdk)).toMatchObject({ format: null, detectedVersions: [], blockedBy: [], warnings: [] })
    const blocked = { code: "VERSION_MISMATCH", message: "This installer says version 2.4.0; this release is 2.5.0.", version: "2.4.0", fields: [], expected: "2.5.0" }
    const read = toReleaseFile({
      ...sdk,
      format: "PE",
      detectedVersions: ["2.4.0"],
      blockedBy: [blocked],
      warnings: [{ code: "NO_VERSION", message: "No version found in this file's name or contents." }],
    })
    expect(read).toMatchObject({ format: "PE", detectedVersions: ["2.4.0"], blockedBy: [blocked] })
    expect(read.warnings).toEqual([{ code: "NO_VERSION", message: "No version found in this file's name or contents." }])
  })

})
