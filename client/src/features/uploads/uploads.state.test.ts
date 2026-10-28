import { describe, expect, it } from "vitest"
import type { OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { FileIssue, PublishJob, ReleaseFileItem } from "@/pages/Releases/releases.model"
import { blocksSubmit, emptyQueue, forRelease, versionBlocked, nextToStart, overall, queueHolder, queueReducer, type PlatformHolder, type QueueState } from "./uploads.state"

const fileOf = (name: string, size = 10) => new File([new Uint8Array(size)], name)

const uploaded = (name: string): ReleaseFileItem => ({ id: `id-${name}`, name, kind: "sdk", os: "windows", contentType: "application/octet-stream", sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-10-22T00:00:00.000Z", format: null, detectedVersions: [], blockedBy: [], warnings: [] })

const noVersion: FileIssue = { code: "NO_VERSION", message: "No version found in this file's name or contents." }
const mismatch: FileIssue = { code: "VERSION_MISMATCH", message: "This installer says version 1.0.0; this release is 2.0.0." }

type Seed = { name: string; size?: number; kind?: "sdk" | "documentation" | null; os?: OperatingSystem | null; holder?: PlatformHolder | null; releaseId?: string }

function added(...files: Seed[]): QueueState {
  return queueReducer(emptyQueue, {
    type: "added",
    items: files.map(({ name, size, kind = "sdk", os = "windows", holder = null, releaseId = "r1" }) => ({ localId: name, releaseId, releaseLabel: "EMASS v1.0.0", file: fileOf(name, size), handle: null, kind, os, holder })),
  })
}

const statusOf = (state: QueueState, localId: string) => state.items.find((item) => item.localId === localId)?.status
// Straight to uploading: checked (hash skipped, as a retry with a known hash does)
const uploading = (state: QueueState, localId: string) => queueReducer(queueReducer(state, { type: "started", localId }), { type: "allowed", localId, warnings: [] })
const fail = (state: QueueState, localId: string) => queueReducer(queueReducer(state, { type: "started", localId }), { type: "failed", localId, error: { code: "X", message: "" } })

describe("queueReducer", () => {
  it("queues every file, typed or not, and holds only platform conflicts", () => {
    const state = added({ name: "a.msi" }, { name: "b.zip", kind: null, os: null }, { name: "c.exe", holder: { fileId: "f1", name: "old.msi" } }, { name: "d.pdf", kind: "documentation", os: "windows" })

    expect(state.items.map((item) => item.status)).toEqual(["queued", "queued", "conflict", "queued"])
    expect(state.items[3].os).toBeNull()
  })

  it("checks, hashes and checks again before uploading", () => {
    let state = added({ name: "a.msi", size: 100 })
    state = queueReducer(state, { type: "started", localId: "a.msi" })
    expect(state.items[0].status).toBe("checking")
    state = queueReducer(state, { type: "hashing", localId: "a.msi", warnings: [noVersion] })
    state = queueReducer(state, { type: "hashProgressed", localId: "a.msi", hashed: 40 })
    expect(state.items[0]).toMatchObject({ status: "hashing", hashed: 40, warnings: [noVersion] })
    state = queueReducer(state, { type: "hashed", localId: "a.msi", sha256: "h" })
    expect(state.items[0]).toMatchObject({ status: "checking", sha256: "h" })
    state = queueReducer(state, { type: "allowed", localId: "a.msi", warnings: [noVersion] })
    expect(state.items[0]).toMatchObject({ status: "uploading", loaded: 0 })
  })

  it("walks an upload through its states", () => {
    let state = uploading(added({ name: "a.msi", size: 100 }), "a.msi")
    state = queueReducer(state, { type: "progressed", localId: "a.msi", loaded: 40 })
    expect(state.items[0]).toMatchObject({ status: "uploading", loaded: 40 })
    state = queueReducer(state, { type: "finalizing", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "finalizing", loaded: 100 })
    state = queueReducer(state, { type: "succeeded", localId: "a.msi", file: uploaded("a.msi") })
    expect(state.items[0]).toMatchObject({ status: "done", result: { id: "id-a.msi" } })
  })

  it("blocks a file with the server's reasons, from any active step", () => {
    const checking = queueReducer(added({ name: "a.exe" }), { type: "started", localId: "a.exe" })
    const state = queueReducer(checking, { type: "blocked", localId: "a.exe", reasons: [mismatch] })
    expect(state.items[0]).toMatchObject({ status: "blocked", blockedBy: [mismatch] })

    // A blocked file never joined the release: it neither counts nor holds up submit
    expect(blocksSubmit(state)).toBe(false)
    expect(overall(state)).toMatchObject({ total: 0 })
    expect(queueReducer(state, { type: "dismissed", localId: "a.exe" }).items).toEqual([])
  })

  it("forgets the hash only when the server saw other bytes", () => {
    let state = queueReducer(added({ name: "a.msi" }), { type: "started", localId: "a.msi" })
    state = queueReducer(state, { type: "hashing", localId: "a.msi", warnings: [] })
    state = queueReducer(state, { type: "hashed", localId: "a.msi", sha256: "h" })
    const failed = queueReducer(state, { type: "failed", localId: "a.msi", error: { code: "X", message: "" } })
    expect(failed.items[0].sha256).toBe("h")
    const mismatched = queueReducer(state, { type: "failed", localId: "a.msi", error: { code: "CHECKSUM_MISMATCH", message: "" }, forgetHash: true })
    expect(mismatched.items[0].sha256).toBeNull()
  })

  it("releases a held file once it's re-mapped somewhere free", () => {
    let state = added({ name: "c.exe", holder: { fileId: "f1", name: "old.msi" } })
    state = queueReducer(state, { type: "mapped", localId: "c.exe", kind: "sdk", os: "macos", holder: { fileId: "f2", name: "mac.dmg" } })
    expect(state.items[0]).toMatchObject({ status: "conflict", holder: { name: "mac.dmg" } })
    state = queueReducer(state, { type: "mapped", localId: "c.exe", kind: "documentation", os: "macos", holder: null })
    expect(state.items[0]).toMatchObject({ status: "queued", kind: "documentation", os: null, holder: null })
  })

  it("replaces only a saved holder", () => {
    const saved = queueReducer(added({ name: "c.exe", holder: { fileId: "f1", name: "old.msi" } }), { type: "replaceRequested", localId: "c.exe" })
    expect(saved.items[0]).toMatchObject({ status: "queued", replaceFileId: "f1", holder: null })

    const inFlight = added({ name: "c.exe", holder: { fileId: null, name: "a.msi" } })
    expect(queueReducer(inFlight, { type: "replaceRequested", localId: "c.exe" })).toBe(inFlight)
  })

  it("turns a server PLATFORM_TAKEN into a held conflict", () => {
    let state = uploading(added({ name: "a.msi" }), "a.msi")
    state = queueReducer(state, { type: "conflicted", localId: "a.msi", holder: { fileId: "f9", name: null } })
    expect(state.items[0]).toMatchObject({ status: "conflict", holder: { fileId: "f9" }, loaded: 0 })
  })

  it("ignores late events for a cancelled upload, except a success", () => {
    let state = uploading(added({ name: "a.msi" }), "a.msi")
    state = queueReducer(state, { type: "cancelled", localId: "a.msi" })
    expect(queueReducer(state, { type: "progressed", localId: "a.msi", loaded: 5 })).toBe(state)
    expect(queueReducer(state, { type: "failed", localId: "a.msi", error: { code: "CANCELLED", message: "" } })).toBe(state)
    expect(statusOf(queueReducer(state, { type: "succeeded", localId: "a.msi", file: uploaded("a.msi") }), "a.msi")).toBe("done")
  })

  it("retries failed and cancelled uploads", () => {
    const state = queueReducer(fail(added({ name: "a.msi" }), "a.msi"), { type: "retried", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "queued", error: null, loaded: 0 })
  })

  it("dismisses finished rows but never an active one", () => {
    let state = added({ name: "a.msi" }, { name: "b.msi" })
    state = queueReducer(state, { type: "started", localId: "a.msi" })
    expect(queueReducer(state, { type: "dismissed", localId: "a.msi" })).toBe(state)
    expect(queueReducer(state, { type: "dismissed", localId: "b.msi" }).items.map((item) => item.localId)).toEqual(["a.msi"])
  })
})

describe("selectors", () => {
  it("starts at most `concurrency` files, in drop order, skipping held files", () => {
    let state = added({ name: "a" }, { name: "held", holder: { fileId: "f", name: "x" } }, { name: "b" }, { name: "c" })
    expect(nextToStart(state, 2).map((item) => item.localId)).toEqual(["a", "b"])
    // Checking and hashing take a slot just like uploading
    state = queueReducer(state, { type: "started", localId: "a" })
    expect(nextToStart(state, 2).map((item) => item.localId)).toEqual(["b"])
  })

  it("weighs overall progress by size and skips cancelled and held files", () => {
    let state = added({ name: "a", size: 100 }, { name: "b", size: 300 }, { name: "c", size: 600 }, { name: "d", size: 50, holder: { fileId: "f", name: "x" } })
    state = uploading(state, "a")
    state = queueReducer(state, { type: "succeeded", localId: "a", file: uploaded("a") })
    state = uploading(state, "b")
    state = queueReducer(state, { type: "progressed", localId: "b", loaded: 150 })
    state = queueReducer(state, { type: "cancelled", localId: "c" })

    expect(overall(state)).toEqual({ done: 1, total: 2, loadedBytes: 250, totalBytes: 400 })
  })

  it("blocks submit while busy, failed or holding a conflict", () => {
    expect(blocksSubmit(emptyQueue)).toBe(false)
    expect(blocksSubmit(added({ name: "a" }))).toBe(true)
    expect(blocksSubmit(queueReducer(added({ name: "a" }), { type: "started", localId: "a" }))).toBe(true)
    expect(blocksSubmit(fail(added({ name: "a" }), "a"))).toBe(true)
    expect(blocksSubmit(queueReducer(added({ name: "a", holder: { fileId: "f", name: "x" } }), { type: "cancelled", localId: "nope" }))).toBe(true)

    const done = queueReducer(uploading(added({ name: "a" }), "a"), { type: "succeeded", localId: "a", file: uploaded("a") })
    expect(blocksSubmit(done)).toBe(false)
  })
})

describe("resumable states", () => {
  const restoredItem = { localId: "r.pkg", releaseId: "r1", releaseLabel: "EMASS v1.0.0", name: "r.pkg", sizeBytes: 100, lastModified: 5, kind: "sdk" as const, os: "macos" as const, replaceFileId: null, sha256: "h", uploadId: "u1", warnings: [], handle: null }

  it("pauses an upload and queues it again on resume, keeping its session", () => {
    let state = uploading(added({ name: "a.msi", size: 100 }), "a.msi")
    state = queueReducer(state, { type: "sessionOpened", localId: "a.msi", uploadId: "u1", loaded: 40 })
    state = queueReducer(state, { type: "paused", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "paused", uploadId: "u1", loaded: 40 })
    // A paused upload frees its slot
    expect(nextToStart(added({ name: "b" }), 1)).toHaveLength(1)

    state = queueReducer(state, { type: "resumed", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "queued", uploadId: "u1" })
  })

  it("waits on the network with its retry time, then carries on where it was", () => {
    let state = uploading(added({ name: "a.msi", size: 100 }), "a.msi")
    state = queueReducer(state, { type: "progressed", localId: "a.msi", loaded: 30 })
    const reason = { kind: "server" as const, message: "Unable to upload file", attempt: 3 }
    state = queueReducer(state, { type: "waiting", localId: "a.msi", retryAt: 5000, reason })
    expect(state.items[0]).toMatchObject({ status: "waiting", retryAt: 5000, loaded: 30, retryReason: reason })
    // Waiting still holds its slot
    expect(nextToStart(queueReducer(state, { type: "added", items: [{ localId: "b", releaseId: "r1", releaseLabel: "", file: fileOf("b"), handle: null, kind: null, os: null, holder: null }] }), 1)).toEqual([])

    state = queueReducer(state, { type: "reconnected", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "uploading", retryAt: null, retryReason: null })
  })

  it("restores unfinished uploads as waiting for their file, once", () => {
    let state = queueReducer(emptyQueue, { type: "restored", items: [restoredItem] })
    expect(state.items[0]).toMatchObject({ status: "needsFile", file: null, sha256: "h", uploadId: "u1" })
    expect(queueReducer(state, { type: "restored", items: [restoredItem] })).toBe(state)
    // Nothing starts without its file, and submit waits for it
    expect(nextToStart(state)).toEqual([])
    expect(blocksSubmit(state)).toBe(true)

    state = queueReducer(state, { type: "wrongFile", localId: "r.pkg", error: { code: "WRONG_FILE", message: "Pick r.pkg" } })
    expect(state.items[0]).toMatchObject({ status: "needsFile", error: { code: "WRONG_FILE" } })
  })

  it("reattaches the same file to its session, or starts a changed one over", () => {
    const restored = queueReducer(emptyQueue, { type: "restored", items: [restoredItem] })
    const file = fileOf("r.pkg", 100)

    const same = queueReducer(restored, { type: "fileReattached", localId: "r.pkg", file, handle: null, keepSession: true, verifyHash: true })
    expect(same.items[0]).toMatchObject({ status: "queued", file, sha256: "h", uploadId: "u1", verifyHash: true, error: null })

    const changed = queueReducer(restored, { type: "fileReattached", localId: "r.pkg", file, handle: null, keepSession: false, verifyHash: false })
    expect(changed.items[0]).toMatchObject({ status: "queued", sha256: null, uploadId: null })
  })

  it("cancels an upload that is paused or waiting for its file", () => {
    const restored = queueReducer(emptyQueue, { type: "restored", items: [restoredItem] })
    expect(queueReducer(restored, { type: "cancelled", localId: "r.pkg" }).items[0].status).toBe("cancelled")
  })
})

describe("one release at a time", () => {
  it("scopes rows and platform holders to their release", () => {
    let state = added({ name: "a-win.msi", releaseId: "r1" }, { name: "b-win.msi", releaseId: "r2" })
    expect(forRelease(state, "r2").items.map((item) => item.localId)).toEqual(["b-win.msi"])
    expect(queueHolder(state, "r1", "windows", "x")).toEqual({ fileId: null, name: "a-win.msi" })
    expect(queueHolder(state, "r3", "windows", "x")).toBeNull()
    state = queueReducer(state, { type: "paused", localId: "a-win.msi" })
    // A paused upload still claims its platform
    expect(queueHolder(state, "r1", "windows", "x")).not.toBeNull()
  })
})

describe("publish items", () => {
  const job = (phase: PublishJob["phase"]): PublishJob => ({ phase, filesTotal: 2, filesDone: 1, percent: 50, error: null, startedAt: "2026-10-28T00:00:00.000Z", finishedAt: null })

  it("tracks, updates, interrupts and dismisses a release's job", () => {
    let state = queueReducer(emptyQueue, { type: "publishTracked", releaseId: "r1", releaseLabel: "", job: job("copying") })
    state = queueReducer(state, { type: "publishUpdated", releaseId: "r1", job: job("finalizing"), releaseLabel: "EMASS v1.0.0" })
    expect(state.publishes).toEqual([{ releaseId: "r1", releaseLabel: "EMASS v1.0.0", job: job("finalizing"), interrupted: false }])

    state = queueReducer(state, { type: "publishInterrupted", releaseId: "r1" })
    expect(state.publishes[0]).toMatchObject({ job: null, interrupted: true })
    // Publishing again clears it, keeping the label
    state = queueReducer(state, { type: "publishTracked", releaseId: "r1", releaseLabel: "", job: job("copying") })
    expect(state.publishes[0]).toMatchObject({ interrupted: false, releaseLabel: "EMASS v1.0.0" })

    expect(queueReducer(state, { type: "publishDismissed", releaseId: "r1" }).publishes).toEqual([])
  })

  it("forgets everything on reset", () => {
    const state = queueReducer(added({ name: "a" }), { type: "publishTracked", releaseId: "r1", releaseLabel: "x", job: null })
    expect(queueReducer(state, { type: "reset" })).toEqual(emptyQueue)
  })
})

describe("version blocks", () => {
  const blockedFor = (...codes: string[]) => {
    let state = queueReducer(added({ name: "a.exe" }), { type: "started", localId: "a.exe" })
    state = queueReducer(state, { type: "hashing", localId: "a.exe", warnings: [] })
    state = queueReducer(state, { type: "hashed", localId: "a.exe", sha256: "h" })
    return queueReducer(state, { type: "blocked", localId: "a.exe", reasons: codes.map((code) => ({ code, message: code })) })
  }

  it("knows a block that a new version could lift", () => {
    expect(versionBlocked(blockedFor("VERSION_MISMATCH").items[0])).toBe(true)
    expect(versionBlocked(blockedFor("VERSION_EXISTS").items[0])).toBe(true)
    expect(versionBlocked(blockedFor("VERSION_MISMATCH", "SAME_CONTENT").items[0])).toBe(false)
    expect(versionBlocked(blockedFor("DAMAGED").items[0])).toBe(false)
  })

  it("queues a blocked file again with its hash, its reasons cleared", () => {
    const state = queueReducer(blockedFor("VERSION_MISMATCH"), { type: "retried", localId: "a.exe" })
    expect(state.items[0]).toMatchObject({ status: "queued", sha256: "h", blockedBy: [] })
  })
})
