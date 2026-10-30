import { describe, expect, it } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import type { ReleaseFileItem, ReleaseSummary } from "@/pages/Releases/releases.model"
import { changedFields, changedMappings, draftsToContinue, draftVersionProblem, effectiveMapping, hasDuplicates, mappingProblems, productOptions, savedHolderFor, serverVersionProblem, submitBlocker, unsavedSummary, versionFromSdks, versionProblem } from "./editor.state"
import { emptyQueue, queueReducer, type QueueState } from "@/features/uploads/uploads.state"

const file = (id: string, kind: ReleaseFileItem["kind"], os: ReleaseFileItem["os"] = null): ReleaseFileItem => ({ id, name: `${id}.bin`, kind, os, contentType: "application/octet-stream", sizeBytes: 1, sha256: "a", createdAt: "2026-10-22T00:00:00.000Z", format: null, detectedVersions: [], blockedBy: [], warnings: [] })

function queueWith(status: "queued" | "failed" | "conflict" | "paused"): QueueState {
  let state = queueReducer(emptyQueue, { type: "added", items: [{ localId: "a", releaseId: "r1", releaseLabel: "EMASS v1.0.0", file: new File(["x"], "a.msi"), handle: null, kind: "sdk", os: "windows", holder: status === "conflict" ? { fileId: "f", name: "x" } : null }] })
  if (status === "failed") {
    state = queueReducer(state, { type: "started", localId: "a" })
    state = queueReducer(state, { type: "failed", localId: "a", error: { code: "X", message: "" } })
  }
  if (status === "paused") state = queueReducer(state, { type: "paused", localId: "a" })
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
  const saved = { product: { id: "p1" }, version: "2.5.0", releaseNotes: "Notes" }
  const form = { productId: "p1", version: "2.5.0", notes: "Notes" }

  it("sends only what changed", () => {
    expect(changedFields(saved, form)).toEqual({})
    expect(changedFields(saved, { ...form, version: " 2.6.0 " })).toEqual({ version: "2.6.0" })
    expect(changedFields(saved, { ...form, notes: "" })).toEqual({ releaseNotes: "" })
    expect(changedFields(saved, { ...form, productId: "p2" })).toEqual({ productId: "p2" })
  })

  it("sends a cleared version as null, and leaves a versionless draft alone", () => {
    expect(changedFields(saved, { ...form, version: "  " })).toEqual({ version: null })
    expect(changedFields({ ...saved, version: null }, { ...form, version: "" })).toEqual({})
  })
})

describe("draftVersionProblem", () => {
  it("lets a draft go without a version, never with a malformed one", () => {
    expect(draftVersionProblem("")).toBeNull()
    expect(draftVersionProblem("2.5.0")).toBeNull()
    expect(draftVersionProblem("2.5")).toBe("Use MAJOR.MINOR.PATCH, for example 2.5.0.")
  })
})

describe("versionFromSdks", () => {
  it("takes the one version the SDK files agree on", () => {
    expect(versionFromSdks([{ kind: "sdk", versions: ["2.3.0"] }, { kind: "sdk", versions: ["2.3.0"] }])).toEqual({ detected: "2.3.0", candidates: ["2.3.0"] })
  })

  it("ignores docs, and SDKs that don't say", () => {
    expect(versionFromSdks([{ kind: "documentation", versions: ["1.2.0"] }, { kind: "sdk", versions: [] }]).detected).toBeNull()
    expect(versionFromSdks([{ kind: "documentation", versions: ["1.2.0"] }, { kind: "sdk", versions: ["2.3.0"] }, { kind: "sdk", versions: [] }]).detected).toBe("2.3.0")
  })

  it("detects nothing when SDKs disagree, but offers both", () => {
    expect(versionFromSdks([{ kind: "sdk", versions: ["2.3.0"] }, { kind: "sdk", versions: ["2.4.0"] }])).toEqual({ detected: null, candidates: ["2.3.0", "2.4.0"] })
  })

  it("leaves files without a type out", () => {
    expect(versionFromSdks([{ kind: null, versions: ["2.3.0"] }]).detected).toBeNull()
  })
})

describe("unsavedSummary", () => {
  it("lists what changed", () => {
    expect(unsavedSummary({ releaseNotes: "x" }, 0)).toBe("notes")
    expect(unsavedSummary({}, 1)).toBe("1 file type")
    expect(unsavedSummary({ version: "1.0.1", releaseNotes: "" }, 2)).toBe("version · notes · 2 file types")
    expect(unsavedSummary({ productId: "p2", version: null }, 0)).toBe("product · version")
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
    expect(submitBlocker({ version: "1.0.0", fileCount: 1, queue: queueWith("paused"), problems: none })).toBe("Resume or cancel the paused uploads.")
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

describe("draftsToContinue", () => {
  const summary = (id: string, status: ReleaseSummary["status"], updatedAt: string, createdById = "dev1"): ReleaseSummary => ({ id, product: { id: "p", name: "EMASS IDE" }, version: `1.0.${id.length}`, status, createdBy: { id: createdById, name: "Dana", role: "DEV" }, createdAt: updatedAt, updatedAt, fileCount: 0, totalBytes: 0 })
  // 100-byte files 61% of the way up, one per release
  const uploadingTo = (...releaseIds: string[]) =>
    releaseIds.reduce((state, releaseId) => {
      const localId = `u-${releaseId}`
      return [
        { type: "added" as const, items: [{ localId, releaseId, releaseLabel: "EMASS SDK v2.0.0", file: new File([new Uint8Array(100)], "a.zip"), handle: null, kind: null, os: null, holder: null }] },
        { type: "started" as const, localId },
        { type: "allowed" as const, localId, warnings: [] },
        { type: "progressed" as const, localId, loaded: 61 },
      ].reduce(queueReducer, state)
    }, emptyQueue)

  it("lists the developer's open drafts, newest first, and nobody else's", () => {
    const drafts = draftsToContinue(
      [summary("old", "draft", "2026-10-01T00:00:00.000Z"), summary("new", "changes_requested", "2026-10-20T00:00:00.000Z"), summary("theirs", "draft", "2026-10-25T00:00:00.000Z", "dev2"), summary("live", "published", "2026-10-26T00:00:00.000Z")],
      emptyQueue,
      "dev1",
    )
    expect(drafts.map((draft) => [draft.id, draft.status])).toEqual([["new", "changes_requested"], ["old", "draft"]])
    expect(drafts[0].uploads).toBeNull()
  })

  it("puts drafts with uploads first, including one not listed yet", () => {
    const drafts = draftsToContinue([summary("listed", "draft", "2026-10-20T00:00:00.000Z"), summary("busy", "draft", "2026-10-01T00:00:00.000Z")], uploadingTo("fresh", "busy"), "dev1")

    expect(drafts.map((draft) => draft.id)).toEqual(["fresh", "busy", "listed"])
    expect(drafts[0]).toMatchObject({ label: "EMASS SDK v2.0.0", status: null })
    expect(drafts[1].uploads).toBe("1 file uploading (61%)")
  })

  it("keeps it to three", () => {
    const many = ["a", "b", "c", "d"].map((id, index) => summary(id, "draft", `2026-10-0${index + 1}T00:00:00.000Z`))
    expect(draftsToContinue(many, emptyQueue, "dev1")).toHaveLength(3)
  })
})

describe("productOptions", () => {
  const current = { id: "p1", name: "Core SDK" }

  it("shows the release's product before the list loads", () => {
    expect(productOptions(null, current)).toEqual([{ value: "p1", label: "Core SDK" }])
  })

  it("uses the loaded list", () => {
    expect(productOptions([current, { id: "p2", name: "Vision SDK" }], current)).toEqual([{ value: "p1", label: "Core SDK" }, { value: "p2", label: "Vision SDK" }])
  })

  it("keeps the release's product when it's no longer listed", () => {
    expect(productOptions([{ id: "p2", name: "Vision SDK" }], current)).toEqual([{ value: "p1", label: "Core SDK" }, { value: "p2", label: "Vision SDK" }])
  })
})
