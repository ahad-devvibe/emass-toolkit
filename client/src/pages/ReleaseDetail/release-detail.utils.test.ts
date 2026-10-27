import { describe, expect, it } from "vitest"
import type { ReleaseEventItem, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { filesUpdatedAfterFeedback, latestEvent, toCatalogFile } from "./release-detail.utils"

const actor = { id: "u1", name: "Dana", role: "DEV" as const }
const event = (type: ReleaseEventItem["type"], at: string, note: string | null = null): ReleaseEventItem => ({ id: `${type}-${at}`, type, actor, note, at })
const file = (name: string, createdAt: string, extra: Partial<ReleaseFileItem> = {}): ReleaseFileItem => ({ id: name, name, kind: "sdk", os: "windows", contentType: "application/octet-stream", sizeBytes: 2048, sha256: "a".repeat(64), createdAt, format: null, detectedVersions: [], blockedBy: [], warnings: [], ...extra })

describe("latestEvent", () => {
  it("finds the newest event of a type", () => {
    const events = [event("changes_requested", "2026-10-01T00:00:00Z", "first"), event("submitted", "2026-10-02T00:00:00Z"), event("changes_requested", "2026-10-03T00:00:00Z", "second")]
    expect(latestEvent({ events }, "changes_requested")?.note).toBe("second")
    expect(latestEvent({ events }, "published")).toBeUndefined()
  })
})

describe("filesUpdatedAfterFeedback", () => {
  it("lists files added after the last change request", () => {
    const release = {
      events: [event("created", "2026-10-01T00:00:00Z"), event("changes_requested", "2026-10-05T00:00:00Z")],
      files: [file("old.msi", "2026-10-02T00:00:00Z"), file("new.dmg", "2026-10-06T00:00:00Z")],
    }
    expect(filesUpdatedAfterFeedback(release).map((item) => item.name)).toEqual(["new.dmg"])
  })

  it("is empty when no changes were requested", () => {
    expect(filesUpdatedAfterFeedback({ events: [], files: [file("a.msi", "2026-10-02T00:00:00Z")] })).toEqual([])
  })
})

describe("toCatalogFile", () => {
  it("shows an SDK by platform with the server checksum", () => {
    expect(toCatalogFile(file("emass.deb", "2026-10-02T00:00:00Z", { os: "linux" }))).toEqual({ id: "emass.deb", kind: "sdk", os: "linux", name: "emass.deb", sizeBytes: 2048, size: "2.0 KB", checksum: "a".repeat(64) })
  })

  it("leaves unmapped files out of the shared list", () => {
    expect(toCatalogFile(file("mystery.zip", "2026-10-02T00:00:00Z", { kind: null, os: null }))).toBeNull()
    expect(toCatalogFile(file("emass.msi", "2026-10-02T00:00:00Z", { kind: "sdk", os: null }))).toBeNull()
  })

  it("shows a doc by its file name and format", () => {
    expect(toCatalogFile(file("guide.pdf", "2026-10-02T00:00:00Z", { kind: "documentation", os: null }))).toMatchObject({ kind: "documentation", title: "guide.pdf", format: "PDF" })
  })
})
