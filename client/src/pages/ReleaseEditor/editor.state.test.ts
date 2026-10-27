import { describe, expect, it } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import type { ReleaseFileItem } from "@/pages/Releases/releases.model"
import { changedFields, changedMappings, effectiveMapping, hasDuplicates, mappingProblems, savedHolderFor, serverVersionProblem, submitBlocker, unsavedSummary, versionProblem } from "./editor.state"
import { emptyQueue, queueReducer, type QueueState } from "./upload-queue"

const file = (id: string, kind: ReleaseFileItem["kind"], os: ReleaseFileItem["os"] = null): ReleaseFileItem => ({ id, name: `${id}.bin`, kind, os, contentType: "application/octet-stream", sizeBytes: 1, sha256: "a", createdAt: "2026-10-22T00:00:00.000Z", format: null, detectedVersions: [], blockedBy: [], warnings: [] })

function queueWith(status: "queued" | "failed" | "conflict"): QueueState {
  let state = queueReducer(emptyQueue, { type: "added", items: [{ localId: "a", file: new File(["x"], "a.msi"), kind: "sdk", os: "windows", holder: status === "conflict" ? { fileId: "f", name: "x" } : null }] })
  if (status === "failed") {
    state = queueReducer(state, { type: "started", localId: "a" })
    state = queueReducer(state, { type: "failed", localId: "a", error: { code: "X", message: "" } })
  }
  return state
}

describe("versionProblem", () => {
  it("checks the format only", () => {
    expect(versionProblem("")).toBe("Enter a version number.")
    expect(versionProblem("2.5")).toBe("Use MAJOR.MINOR.PATCH, for example 2.5.0.")
    expect(versionProblem("v2.5.0")).not.toBeNull()
    expect(versionProblem(" 2.5.0 ")).toBeNull()
  })
})

describe("serverVersionProblem", () => {
  it("words the server's version errors for the field", () => {
    expect(serverVersionProblem(new ApiRequestError(409, "VERSION_NOT_NEWER", "x", {}, { highestShipped: "2.5.0" }))).toBe("Must be newer than v2.5.0, the latest shipped version.")
    expect(serverVersionProblem(new ApiRequestError(409, "VERSION_TAKEN", "x"))).toBe("This product already has a release with that version.")
    expect(serverVersionProblem(new ApiRequestError(400, "VALIDATION_ERROR", "x", { version: ["Version must look like 1.2.3"] }))).toBe("Version must look like 1.2.3")
    expect(serverVersionProblem(new ApiRequestError(500, "INTERNAL_ERROR", "x"))).toBeNull()
  })
})

describe("changedFields", () => {
  const saved = { version: "2.5.0", releaseNotes: "Notes" }

  it("sends only what changed", () => {
    expect(changedFields(saved, { version: "2.5.0", notes: "Notes" })).toEqual({})
    expect(changedFields(saved, { version: " 2.6.0 ", notes: "Notes" })).toEqual({ version: "2.6.0" })
    expect(changedFields(saved, { version: "2.5.0", notes: "" })).toEqual({ releaseNotes: "" })
  })
})

describe("unsavedSummary", () => {
  it("lists what changed", () => {
    expect(unsavedSummary({ releaseNotes: "x" }, 0)).toBe("notes")
    expect(unsavedSummary({}, 1)).toBe("1 file type")
    expect(unsavedSummary({ version: "1.0.1", releaseNotes: "" }, 2)).toBe("version · notes · 2 file types")
    expect(unsavedSummary({}, 0)).toBe("")
  })
})

describe("mappings", () => {
  const files = [file("win", "sdk", "windows"), file("mac", "sdk", "macos"), file("doc", "documentation"), file("new", null)]

  it("shows local edits over the saved values, without a platform on docs", () => {
    expect(effectiveMapping(files[0], {})).toEqual({ kind: "sdk", os: "windows" })
    expect(effectiveMapping(files[0], { win: { kind: "documentation", os: "windows" } })).toEqual({ kind: "documentation", os: null })
  })

  it("sends only real changes, including a swap", () => {
    const swap = { win: { kind: "sdk" as const, os: "macos" as const }, mac: { kind: "sdk" as const, os: "windows" as const }, doc: { kind: "documentation" as const, os: null } }
    expect(changedMappings(files, swap)).toEqual([
      { id: "win", kind: "sdk", os: "macos" },
      { id: "mac", kind: "sdk", os: "windows" },
    ])
  })

  it("flags duplicates, missing platforms and missing types", () => {
    const problems = mappingProblems(files, { doc: { kind: "sdk", os: "windows" }, mac: { kind: "sdk", os: null } })
    expect(problems).toEqual({
      win: { type: "duplicate", os: "windows", others: ["doc.bin"] },
      doc: { type: "duplicate", os: "windows", others: ["win.bin"] },
      mac: { type: "needsPlatform" },
      new: { type: "needsType" },
    })
    expect(hasDuplicates(problems)).toBe(true)
  })

  it("has no duplicate after a full swap", () => {
    const swap = { win: { kind: "sdk" as const, os: "macos" as const }, mac: { kind: "sdk" as const, os: "windows" as const } }
    expect(hasDuplicates(mappingProblems(files, swap))).toBe(false)
  })

  it("finds the saved holder of a platform by the edited mapping", () => {
    expect(savedHolderFor(files, {}, "windows")).toEqual({ fileId: "win", name: "win.bin" })
    expect(savedHolderFor(files, { win: { kind: "documentation", os: null } }, "windows")).toBeNull()
  })
})

describe("submitBlocker", () => {
  const none = {}

  it("names the first thing in the way", () => {
    expect(submitBlocker({ version: "x", fileCount: 1, queue: emptyQueue, problems: none })).toBe("Fix the version number first.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: queueWith("queued"), problems: none })).toBe("Wait for uploads to finish.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: queueWith("failed"), problems: none })).toBe("Retry or remove the failed uploads.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: queueWith("conflict"), problems: none })).toBe("Replace or re-map the uploads held on a platform.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: emptyQueue, problems: none, blockedFiles: 1 })).toBe("Remove the files that can't be submitted, or change the version.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: emptyQueue, problems: { a: { type: "duplicate", os: "windows", others: [] } } })).toBe("Each platform can have only one SDK.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: emptyQueue, problems: { a: { type: "needsType" } } })).toBe("Choose a type for every file.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: emptyQueue, problems: { a: { type: "needsPlatform" } } })).toBe("Choose a platform for every SDK.")
    expect(submitBlocker({ version: "1.0.0", fileCount: 0, queue: emptyQueue, problems: none })).toBe("Add at least one file.")
  })

  it("clears once everything is in place", () => {
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: emptyQueue, problems: none })).toBeNull()
  })
})
