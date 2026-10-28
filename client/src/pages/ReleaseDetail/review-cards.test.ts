import { describe, expect, it } from "vitest"
import type { FileIssue, ReleaseDetail, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { bumpKind, reviewCards, type LiveVersion } from "./review-cards"

const issue = (code: string): FileIssue => ({ code, message: code })
const file = (name: string, overrides: Partial<ReleaseFileItem> = {}): ReleaseFileItem => ({ id: name, name, kind: "sdk", os: "windows", contentType: "application/octet-stream", sizeBytes: 1, sha256: `h-${name}`, createdAt: "2026-10-28T00:00:00.000Z", format: "PE", detectedVersions: ["1.4.0"], blockedBy: [], warnings: [], ...overrides })
const allSdks = [file("win.exe"), file("mac.pkg", { os: "macos", format: "PKG" }), file("ubuntu.deb", { os: "linux", format: "DEB" })]
const guide = file("guide.pdf", { kind: "documentation", os: null, format: "PDF" })

function release(files: ReleaseFileItem[], { previous = "1.3.0" as string | null, notes = "Fixes and faster builds." } = {}): ReleaseDetail {
  return {
    id: "r1",
    product: { id: "p", name: "EMASS IDE" },
    version: "1.4.0",
    status: "in_review",
    createdBy: { id: "d", name: "Dana", role: "DEV" },
    createdAt: "2026-10-28T00:00:00.000Z",
    updatedAt: "2026-10-28T00:00:00.000Z",
    fileCount: files.length,
    totalBytes: files.length,
    releaseNotes: notes,
    publishedAt: null,
    publishedBy: null,
    files,
    events: [],
    review: { currentPublished: previous ? { id: "old", version: previous } : null, restoreTarget: null },
  }
}

const live = (files: { sha256: string }[] = []): LiveVersion => ({ version: "1.3.0", files })
const card = (r: ReleaseDetail, key: string, l: LiveVersion = live()) => reviewCards(r, l).find((c) => c.key === key)!

describe("bumpKind", () => {
  it("names the part that changed", () => {
    expect(bumpKind("1.3.0", "2.0.0")).toBe("major")
    expect(bumpKind("1.3.0", "1.4.0")).toBe("minor")
    expect(bumpKind("1.3.0", "1.3.1")).toBe("patch")
    expect(bumpKind("1.3", "1.4.0")).toBeNull()
  })
})

describe("version card", () => {
  it("shows the step from the live version, and all files matching", () => {
    expect(card(release([...allSdks, guide]), "version")).toMatchObject({ value: "v1.3.0 → v1.4.0", title: "Version · minor", tone: "ok", detail: "All files match v1.4.0" })
  })

  it("marks a first release", () => {
    expect(card(release(allSdks, { previous: null }), "version")).toMatchObject({ value: "v1.4.0", title: "Version · first release" })
  })

  it("is red for an installer of another version, amber for a doc that doesn't say", () => {
    expect(card(release([file("old.exe", { blockedBy: [issue("VERSION_MISMATCH")] })]), "version")).toMatchObject({ tone: "bad", detail: "1 installer says another version" })
    const docs = [file("a.pdf", { kind: "documentation", warnings: [issue("DOC_VERSION_MISMATCH")] }), file("b.pdf", { kind: "documentation", warnings: [issue("NO_VERSION")] })]
    expect(card(release(docs), "version")).toMatchObject({ tone: "warn", detail: "2 files don't mention v1.4.0" })
  })
})

describe("checksum card", () => {
  it("is green when nothing is reused from the live version", () => {
    expect(card(release([...allSdks, guide]), "checksums", live([{ sha256: "h-other" }]))).toMatchObject({ value: "SHA-256 verified", tone: "ok", detail: "All files new since v1.3.0" })
  })

  it("warns about a doc unchanged from the live version, by name", () => {
    expect(card(release([...allSdks, guide]), "checksums", live([{ sha256: "h-guide.pdf" }]))).toMatchObject({ tone: "warn", detail: "guide.pdf is unchanged from v1.3.0" })
  })

  it("is red for an installer that repeats an earlier build", () => {
    expect(card(release([file("a.exe", { blockedBy: [issue("SAME_CONTENT")] })]), "checksums")).toMatchObject({ tone: "bad", detail: "1 installer repeats an earlier build" })
  })

  it("has nothing to compare for a first release, and says so while loading", () => {
    expect(card(release(allSdks, { previous: null }), "checksums", null)).toMatchObject({ tone: "neutral", detail: "First release · nothing earlier to compare" })
    expect(card(release(allSdks), "checksums", { version: "1.3.0", files: null })).toMatchObject({ tone: "neutral", detail: "Comparing with v1.3.0…" })
    expect(card(release(allSdks), "checksums", { version: "1.3.0", files: null, unavailable: true })).toMatchObject({ tone: "neutral", detail: "Couldn't load v1.3.0 to compare" })
  })
})

describe("SDK card", () => {
  it("counts platforms out of 3: green, amber, red", () => {
    expect(card(release(allSdks), "sdks")).toMatchObject({ value: "3 / 3 platforms", tone: "ok", platforms: ["windows", "macos", "linux"] })
    expect(card(release(allSdks.slice(0, 2)), "sdks")).toMatchObject({ value: "2 / 3 platforms", tone: "warn", detail: "Missing: Ubuntu" })
    expect(card(release(allSdks.slice(0, 1)), "sdks")).toMatchObject({ tone: "bad", detail: "Missing: macOS, Ubuntu" })
    expect(card(release([]), "sdks")).toMatchObject({ value: "0 / 3 platforms", tone: "bad" })
  })

  it("counts a platform once and ignores SDKs without one", () => {
    expect(card(release([file("a.exe"), file("b.exe"), file("c.bin", { os: null })]), "sdks")).toMatchObject({ value: "1 / 3 platforms" })
  })
})

describe("docs card", () => {
  it("is green with docs and notes, amber with one missing, red with both", () => {
    expect(card(release([guide]), "docs")).toMatchObject({ value: "1 doc · notes written", tone: "ok" })
    expect(card(release([guide], { notes: "   " }), "docs")).toMatchObject({ value: "1 doc · no notes", tone: "warn", detail: "Release notes aren't written" })
    expect(card(release(allSdks), "docs")).toMatchObject({ value: "No docs · notes written", tone: "warn", detail: "No documentation attached" })
    expect(card(release(allSdks, { notes: "" }), "docs")).toMatchObject({ tone: "bad" })
  })
})
