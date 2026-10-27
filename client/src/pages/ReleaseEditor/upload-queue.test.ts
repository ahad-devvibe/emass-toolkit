import { describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import type { UploadOptions } from "@/lib/api/upload"
import type { HashFn } from "@/lib/hash/hash-file"
import type { OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { FileIssue, ReleaseFileItem } from "@/pages/Releases/releases.model"
import type { CheckFn, CheckRequest, FileVerdict } from "./file-check"
import { blocksSubmit, createUploadQueue, emptyQueue, nextToStart, overall, queueReducer, type PlatformHolder, type QueueState, type UploadRequest } from "./upload-queue"

const fileOf = (name: string, size = 10) => new File([new Uint8Array(size)], name)

const uploaded = (name: string): ReleaseFileItem => ({ id: `id-${name}`, name, kind: "sdk", os: "windows", contentType: "application/octet-stream", sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-10-22T00:00:00.000Z", format: null, detectedVersions: [], blockedBy: [], warnings: [] })

const noVersion: FileIssue = { code: "NO_VERSION", message: "No version found in this file's name or contents." }
const mismatch: FileIssue = { code: "VERSION_MISMATCH", message: "This installer says version 1.0.0; this release is 2.0.0." }
const blockedError = (reasons: FileIssue[]) => new ApiRequestError(409, "FILE_BLOCKED", reasons[0].message, {}, { reasons })

type Seed = { name: string; size?: number; kind?: "sdk" | "documentation" | null; os?: OperatingSystem | null; holder?: PlatformHolder | null }

function added(...files: Seed[]): QueueState {
  return queueReducer(emptyQueue, {
    type: "added",
    items: files.map(({ name, size, kind = "sdk", os = "windows", holder = null }) => ({ localId: name, file: fileOf(name, size), kind, os, holder })),
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

// --- Runner ---

type Call = { request: UploadRequest; options: UploadOptions; resolve: (file: ReleaseFileItem) => void; reject: (error: unknown) => void }

function fakeUpload() {
  const calls: Call[] = []
  const upload = vi.fn((request: UploadRequest, options: UploadOptions) => new Promise<ReleaseFileItem>((resolve, reject) => calls.push({ request, options, resolve, reject })))
  return { upload, calls }
}

const allowed = (warnings: FileIssue[] = []): FileVerdict => ({ status: "ALLOWED", format: "OTHER", versions: [], warnings })

// By default every check passes and a file's hash is "h-<name>"
function fakeChecks(verdict: (file: File, request: CheckRequest) => Promise<FileVerdict> = async () => allowed()) {
  const check = vi.fn<CheckFn>((file, request) => verdict(file, { ...request }))
  const hash = vi.fn<HashFn>(async (file: File) => `h-${file.name}`)
  return { check, hash }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function queueWith(upload: ReturnType<typeof fakeUpload>["upload"], saved: Partial<Record<OperatingSystem, PlatformHolder>> = {}, checks = fakeChecks(), findUploaded?: (sha256: string) => Promise<ReleaseFileItem | null>) {
  let id = 0
  let clock = 0
  const onUploaded = vi.fn()
  // Lookups after a lost response run back to back in tests
  const queue = createUploadQueue({ upload, ...checks, findUploaded, sleep: async () => {}, onUploaded, savedHolder: (os) => saved[os] ?? null, newId: () => `q${++id}`, now: () => (clock += 1000) })
  return { queue, onUploaded, ...checks }
}

describe("createUploadQueue", () => {
  it("checks versions, hashes, checks with the hash, then uploads with it", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, check, hash } = queueWith(upload)

    queue.add([fileOf("a.msi")])
    await settle()

    expect(check.mock.calls.map(([, request]) => request.sha256)).toEqual([undefined, "h-a.msi"])
    expect(hash).toHaveBeenCalledOnce()
    expect(calls[0].request).toMatchObject({ kind: "sdk", os: "windows", sha256: "h-a.msi" })
  })

  it("never hashes or uploads a file whose versions are blocked", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, hash } = queueWith(upload, {}, fakeChecks(async () => { throw blockedError([mismatch]) }))

    queue.add([fileOf("old.exe")])
    await settle()

    expect(hash).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "blocked", blockedBy: [mismatch] })
  })

  it("never uploads a file blocked once its hash is known", async () => {
    const { upload, calls } = fakeUpload()
    const same: FileIssue = { code: "SAME_CONTENT", message: 'Identical to "a.msi" in v1.0.0.' }
    const { queue } = queueWith(upload, {}, fakeChecks(async (_file, request) => {
      if (request.sha256) throw blockedError([same])
      return allowed()
    }))

    queue.add([fileOf("a.msi")])
    await settle()

    expect(calls).toHaveLength(0)
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "blocked", blockedBy: [same] })
  })

  it("shows the check's warnings while the file uploads", async () => {
    const { upload } = fakeUpload()
    const { queue } = queueWith(upload, {}, fakeChecks(async () => allowed([noVersion])))

    queue.add([fileOf("notes.txt")])
    await settle()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "uploading", warnings: [noVersion] })
  })

  it("blocks a file the server refuses on upload (a race with another upload)", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi")])
    await settle()
    calls[0].reject(blockedError([mismatch]))
    await settle()

    expect(queue.getSnapshot().items[0].status).toBe("blocked")
  })

  it("hashes again on retry only when the server saw other bytes", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, hash } = queueWith(upload)

    queue.add([fileOf("a.msi")])
    await settle()
    calls[0].reject(new Error("network"))
    await settle()
    queue.retry("q1")
    await settle()
    expect(hash).toHaveBeenCalledOnce()

    calls[1].reject(new ApiRequestError(422, "CHECKSUM_MISMATCH", "changed"))
    await settle()
    expect(queue.getSnapshot().items[0].error).toMatchObject({ code: "CHECKSUM_MISMATCH", message: "The file changed while uploading. Retry to check it again." })
    queue.retry("q1")
    await settle()
    expect(hash).toHaveBeenCalledTimes(2)
  })

  it("finishes an upload whose response was lost but whose file landed", async () => {
    const { upload, calls } = fakeUpload()
    const findUploaded = vi.fn(async (sha256: string) => (sha256 === "h-a.pkg" ? uploaded("a.pkg") : null))
    const { queue, onUploaded } = queueWith(upload, {}, fakeChecks(), findUploaded)

    queue.add([fileOf("a.pkg")])
    await settle()
    calls[0].reject(new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the server."))
    await settle()

    expect(findUploaded).toHaveBeenCalledWith("h-a.pkg")
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "done", result: { id: "id-a.pkg" } })
    expect(onUploaded).toHaveBeenCalledOnce()
  })

  it("keeps looking for a few seconds, since the server may still be saving the file", async () => {
    const { upload, calls } = fakeUpload()
    let lookups = 0
    const findUploaded = vi.fn(async () => (++lookups === 3 ? uploaded("a.exe") : null))
    const { queue } = queueWith(upload, {}, fakeChecks(), findUploaded)

    queue.add([fileOf("a.exe")])
    await settle()
    calls[0].reject(new ApiRequestError(408, "SERVER_UNAVAILABLE", "The server is unavailable right now."))
    await settle()

    expect(findUploaded).toHaveBeenCalledTimes(3)
    expect(queue.getSnapshot().items[0].status).toBe("done")
  })

  it("treats a retry refused as the same bytes as done, when they're in this release", async () => {
    const { upload, calls } = fakeUpload()
    const same: FileIssue = { code: "SAME_CONTENT", message: 'Already in this release as "a.pkg".' }
    let landed = false
    const checks = fakeChecks(async (_file, request) => {
      if (request.sha256 && landed) throw blockedError([same])
      return allowed()
    })
    const findUploaded = vi.fn(async () => (landed ? uploaded("a.pkg") : null))
    const { queue } = queueWith(upload, {}, checks, findUploaded)

    queue.add([fileOf("a.pkg")])
    await settle()
    // The server saved it, but the lookup right after the drop didn't see it yet
    calls[0].reject(new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the server."))
    await settle()
    expect(queue.getSnapshot().items[0].status).toBe("failed")

    landed = true
    queue.retry("q1")
    await settle()
    expect(queue.getSnapshot().items[0].status).toBe("done")
    expect(calls).toHaveLength(1)
  })

  it("still blocks identical bytes that are in another release", async () => {
    const { upload } = fakeUpload()
    const same: FileIssue = { code: "SAME_CONTENT", message: 'Identical to "a.pkg" in v1.0.0.' }
    const findUploaded = vi.fn(async () => null)
    const { queue } = queueWith(upload, {}, fakeChecks(async (_file, request) => {
      if (request.sha256) throw blockedError([same])
      return allowed()
    }), findUploaded)

    queue.add([fileOf("a.pkg")])
    await settle()

    expect(findUploaded).toHaveBeenCalledOnce()
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "blocked", blockedBy: [same] })
  })

  it("cancels while hashing by aborting the hash", async () => {
    const { upload, calls } = fakeUpload()
    const checks = fakeChecks()
    let hashSignal: AbortSignal | undefined
    checks.hash.mockImplementation((_file, options) => {
      hashSignal = options?.signal
      return new Promise(() => {})
    })
    const { queue } = queueWith(upload, {}, checks)

    queue.add([fileOf("a.msi")])
    await settle()
    expect(queue.getSnapshot().items[0].status).toBe("hashing")
    queue.cancel("q1")

    expect(hashSignal?.aborted).toBe(true)
    expect(queue.getSnapshot().items[0].status).toBe("cancelled")
    expect(calls).toHaveLength(0)
  })

  it("runs two files at a time, counting checks, and starts the next when one finishes", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, onUploaded, check } = queueWith(upload)

    queue.add([fileOf("a.msi"), fileOf("b.dmg"), fileOf("c.deb")])
    expect(check.mock.calls.map(([file]) => file.name)).toEqual(["a.msi", "b.dmg"])
    await settle()
    expect(calls.map((call) => call.request.file.name)).toEqual(["a.msi", "b.dmg"])

    calls[0].resolve(uploaded("a.msi"))
    await settle()

    expect(calls.map((call) => call.request.file.name)).toEqual(["a.msi", "b.dmg", "c.deb"])
    expect(onUploaded).toHaveBeenCalledOnce()
  })

  it("uploads undetected files right away, unmapped", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("guide.pdf"), fileOf("mystery.zip")])
    await settle()

    expect(calls.map((call) => call.request)).toEqual([
      { file: expect.any(File), kind: "documentation", os: null, sha256: "h-guide.pdf" },
      { file: expect.any(File), kind: null, os: null, sha256: "h-mystery.zip" },
    ])
  })

  it("holds a file whose detected platform a saved file already has", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, check } = queueWith(upload, { windows: { fileId: "f1", name: "old.msi" } })

    queue.add([fileOf("new.msi"), fileOf("guide.pdf")])
    await settle()

    expect(check.mock.calls.map(([file]) => file.name)).not.toContain("new.msi")
    expect(calls.map((call) => call.request.file.name)).toEqual(["guide.pdf"])
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "conflict", holder: { fileId: "f1", name: "old.msi" } })
  })

  it("holds the second of two dropped builds for one platform", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a-win.msi"), fileOf("b-win.exe")])
    await settle()

    expect(calls).toHaveLength(1)
    expect(queue.getSnapshot().items[1]).toMatchObject({ status: "conflict", holder: { fileId: null, name: "a-win.msi" } })
  })

  it("replaces the saved holder on request, checking against the file it replaces", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, check } = queueWith(upload, { windows: { fileId: "f1", name: "old.msi" } })

    queue.add([fileOf("new.msi")])
    queue.replace("q1")
    await settle()

    expect(check.mock.calls[0][1]).toMatchObject({ replace: "f1" })
    expect(calls[0].request).toMatchObject({ kind: "sdk", os: "windows", replace: "f1" })
  })

  it("uploads a held file once it's mapped somewhere free", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload, { windows: { fileId: "f1", name: "old.msi" } })

    queue.add([fileOf("new.msi")])
    queue.map("q1", "sdk", "windows")
    await settle()
    expect(calls).toHaveLength(0)
    queue.map("q1", "documentation", null)
    await settle()

    expect(calls[0].request).toMatchObject({ kind: "documentation", os: null })
  })

  it("turns a server PLATFORM_TAKEN into a held conflict", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi")])
    await settle()
    calls[0].reject(new ApiRequestError(409, "PLATFORM_TAKEN", "taken", {}, { fileId: "f9" }))
    await settle()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "conflict", holder: { fileId: "f9" } })
  })

  it("reports progress, then finalizing once every byte is sent", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi", 100)])
    await settle()
    calls[0].options.onProgress?.(40, 100)
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "uploading", loaded: 40 })
    calls[0].options.onProgress?.(100, 100)
    expect(queue.getSnapshot().items[0].status).toBe("finalizing")
  })

  it("cancels by aborting the request and moves on to the next file", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi"), fileOf("b.dmg"), fileOf("c.deb")])
    await settle()
    queue.cancel("q1")
    expect(calls[0].options.signal?.aborted).toBe(true)
    calls[0].reject(new ApiRequestError(0, "CANCELLED", "cancelled"))
    await settle()

    expect(queue.getSnapshot().items.map((item) => item.status)).toEqual(["cancelled", "uploading", "uploading"])
  })

  it("retries a failed upload", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi")])
    await settle()
    calls[0].reject(new Error("boom"))
    await settle()
    expect(queue.getSnapshot().items[0].error).toMatchObject({ code: "UNKNOWN" })

    queue.retry("q1")
    await settle()
    calls[1].resolve(uploaded("a.msi"))
    await settle()
    expect(queue.getSnapshot().items[0].status).toBe("done")
  })

  it("uses the latest hooks after configure", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.configure({ savedHolder: (os) => (os === "macos" ? { fileId: "m", name: "mac.dmg" } : null) })
    queue.add([fileOf("new.dmg")])
    await settle()

    expect(calls).toHaveLength(0)
  })

  it("dispose aborts every running upload", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi"), fileOf("b.dmg")])
    await settle()
    queue.dispose()

    expect(calls.every((call) => call.options.signal?.aborted)).toBe(true)
  })
})
