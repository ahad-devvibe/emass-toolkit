import { describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import type { UploadOptions } from "@/lib/api/upload"
import type { OperatingSystem } from "@/pages/Catalog/catalog.types"
import type { ReleaseFileItem } from "@/pages/Releases/releases.model"
import { blocksSubmit, createUploadQueue, emptyQueue, nextToStart, overall, queueReducer, type PlatformHolder, type QueueState, type UploadRequest } from "./upload-queue"

const fileOf = (name: string, size = 10) => new File([new Uint8Array(size)], name)

const uploaded = (name: string): ReleaseFileItem => ({ id: `id-${name}`, name, kind: "sdk", os: "windows", contentType: "application/octet-stream", sizeBytes: 10, sha256: "a".repeat(64), createdAt: "2026-10-22T00:00:00.000Z" })

type Seed = { name: string; size?: number; kind?: "sdk" | "documentation" | null; os?: OperatingSystem | null; holder?: PlatformHolder | null }

function added(...files: Seed[]): QueueState {
  return queueReducer(emptyQueue, {
    type: "added",
    items: files.map(({ name, size, kind = "sdk", os = "windows", holder = null }) => ({ localId: name, file: fileOf(name, size), kind, os, holder })),
  })
}

const statusOf = (state: QueueState, localId: string) => state.items.find((item) => item.localId === localId)?.status
const fail = (state: QueueState, localId: string) => queueReducer(queueReducer(state, { type: "started", localId }), { type: "failed", localId, error: { code: "X", message: "" } })

describe("queueReducer", () => {
  it("queues every file, typed or not, and holds only platform conflicts", () => {
    const state = added({ name: "a.msi" }, { name: "b.zip", kind: null, os: null }, { name: "c.exe", holder: { fileId: "f1", name: "old.msi" } }, { name: "d.pdf", kind: "documentation", os: "windows" })

    expect(state.items.map((item) => item.status)).toEqual(["queued", "queued", "conflict", "queued"])
    expect(state.items[3].os).toBeNull()
  })

  it("walks an upload through its states", () => {
    let state = added({ name: "a.msi", size: 100 })
    state = queueReducer(state, { type: "started", localId: "a.msi" })
    state = queueReducer(state, { type: "progressed", localId: "a.msi", loaded: 40 })
    expect(state.items[0]).toMatchObject({ status: "uploading", loaded: 40 })
    state = queueReducer(state, { type: "finalizing", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "finalizing", loaded: 100 })
    state = queueReducer(state, { type: "succeeded", localId: "a.msi", file: uploaded("a.msi") })
    expect(state.items[0]).toMatchObject({ status: "done", result: { id: "id-a.msi" } })
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
    let state = queueReducer(added({ name: "a.msi" }), { type: "started", localId: "a.msi" })
    state = queueReducer(state, { type: "conflicted", localId: "a.msi", holder: { fileId: "f9", name: null } })
    expect(state.items[0]).toMatchObject({ status: "conflict", holder: { fileId: "f9" }, loaded: 0 })
  })

  it("ignores late events for a cancelled upload, except a success", () => {
    let state = added({ name: "a.msi" })
    state = queueReducer(state, { type: "started", localId: "a.msi" })
    state = queueReducer(state, { type: "cancelled", localId: "a.msi" })
    expect(queueReducer(state, { type: "progressed", localId: "a.msi", loaded: 5 })).toBe(state)
    expect(queueReducer(state, { type: "failed", localId: "a.msi", error: { code: "CANCELLED", message: "" } })).toBe(state)
    expect(statusOf(queueReducer(state, { type: "succeeded", localId: "a.msi", file: uploaded("a.msi") }), "a.msi")).toBe("done")
  })

  it("retries failed and cancelled uploads", () => {
    const state = queueReducer(fail(added({ name: "a.msi" }), "a.msi"), { type: "retried", localId: "a.msi" })
    expect(state.items[0]).toMatchObject({ status: "queued", error: null, loaded: 0 })
  })

  it("dismisses finished rows but never an active upload", () => {
    let state = added({ name: "a.msi" }, { name: "b.msi" })
    state = queueReducer(state, { type: "started", localId: "a.msi" })
    expect(queueReducer(state, { type: "dismissed", localId: "a.msi" })).toBe(state)
    expect(queueReducer(state, { type: "dismissed", localId: "b.msi" }).items.map((item) => item.localId)).toEqual(["a.msi"])
  })
})

describe("selectors", () => {
  it("starts at most `concurrency` uploads, in drop order, skipping held files", () => {
    let state = added({ name: "a" }, { name: "held", holder: { fileId: "f", name: "x" } }, { name: "b" }, { name: "c" })
    expect(nextToStart(state, 2).map((item) => item.localId)).toEqual(["a", "b"])
    state = queueReducer(state, { type: "started", localId: "a" })
    expect(nextToStart(state, 2).map((item) => item.localId)).toEqual(["b"])
  })

  it("weighs overall progress by size and skips cancelled and held files", () => {
    let state = added({ name: "a", size: 100 }, { name: "b", size: 300 }, { name: "c", size: 600 }, { name: "d", size: 50, holder: { fileId: "f", name: "x" } })
    state = queueReducer(state, { type: "started", localId: "a" })
    state = queueReducer(state, { type: "succeeded", localId: "a", file: uploaded("a") })
    state = queueReducer(state, { type: "started", localId: "b" })
    state = queueReducer(state, { type: "progressed", localId: "b", loaded: 150 })
    state = queueReducer(state, { type: "cancelled", localId: "c" })

    expect(overall(state)).toEqual({ done: 1, total: 2, loadedBytes: 250, totalBytes: 400 })
  })

  it("blocks submit while busy, failed or holding a conflict", () => {
    expect(blocksSubmit(emptyQueue)).toBe(false)
    expect(blocksSubmit(added({ name: "a" }))).toBe(true)
    expect(blocksSubmit(fail(added({ name: "a" }), "a"))).toBe(true)
    expect(blocksSubmit(queueReducer(added({ name: "a", holder: { fileId: "f", name: "x" } }), { type: "cancelled", localId: "nope" }))).toBe(true)

    let done = queueReducer(added({ name: "a" }), { type: "started", localId: "a" })
    done = queueReducer(done, { type: "succeeded", localId: "a", file: uploaded("a") })
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function queueWith(upload: ReturnType<typeof fakeUpload>["upload"], saved: Partial<Record<OperatingSystem, PlatformHolder>> = {}) {
  let id = 0
  let clock = 0
  const onUploaded = vi.fn()
  const queue = createUploadQueue({ upload, onUploaded, savedHolder: (os) => saved[os] ?? null, newId: () => `q${++id}`, now: () => (clock += 1000) })
  return { queue, onUploaded }
}

describe("createUploadQueue", () => {
  it("runs two uploads at a time and starts the next when one finishes", async () => {
    const { upload, calls } = fakeUpload()
    const { queue, onUploaded } = queueWith(upload)

    queue.add([fileOf("a.msi"), fileOf("b.dmg"), fileOf("c.deb")])
    expect(calls.map((call) => call.request.file.name)).toEqual(["a.msi", "b.dmg"])

    calls[0].resolve(uploaded("a.msi"))
    await settle()

    expect(calls.map((call) => call.request.file.name)).toEqual(["a.msi", "b.dmg", "c.deb"])
    expect(onUploaded).toHaveBeenCalledOnce()
  })

  it("uploads undetected files right away, unmapped", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("guide.pdf"), fileOf("mystery.zip")])

    expect(calls.map((call) => call.request)).toEqual([
      { file: expect.any(File), kind: "documentation", os: null },
      { file: expect.any(File), kind: null, os: null },
    ])
  })

  it("holds a file whose detected platform a saved file already has", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload, { windows: { fileId: "f1", name: "old.msi" } })

    queue.add([fileOf("new.msi"), fileOf("guide.pdf")])

    expect(calls.map((call) => call.request.file.name)).toEqual(["guide.pdf"])
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "conflict", holder: { fileId: "f1", name: "old.msi" } })
  })

  it("holds the second of two dropped builds for one platform", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a-win.msi"), fileOf("b-win.exe")])

    expect(calls).toHaveLength(1)
    expect(queue.getSnapshot().items[1]).toMatchObject({ status: "conflict", holder: { fileId: null, name: "a-win.msi" } })
  })

  it("replaces the saved holder on request", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload, { windows: { fileId: "f1", name: "old.msi" } })

    queue.add([fileOf("new.msi")])
    queue.replace("q1")

    expect(calls[0].request).toMatchObject({ kind: "sdk", os: "windows", replace: "f1" })
  })

  it("uploads a held file once it's mapped somewhere free", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload, { windows: { fileId: "f1", name: "old.msi" } })

    queue.add([fileOf("new.msi")])
    queue.map("q1", "sdk", "windows")
    expect(calls).toHaveLength(0)
    queue.map("q1", "documentation", null)

    expect(calls[0].request).toMatchObject({ kind: "documentation", os: null })
  })

  it("turns a server PLATFORM_TAKEN into a held conflict", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi")])
    calls[0].reject(new ApiRequestError(409, "PLATFORM_TAKEN", "taken", {}, { fileId: "f9" }))
    await settle()

    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "conflict", holder: { fileId: "f9" } })
  })

  it("reports progress, then finalizing once every byte is sent", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi", 100)])
    calls[0].options.onProgress?.(40, 100)
    expect(queue.getSnapshot().items[0]).toMatchObject({ status: "uploading", loaded: 40 })
    calls[0].options.onProgress?.(100, 100)
    expect(queue.getSnapshot().items[0].status).toBe("finalizing")
  })

  it("cancels by aborting the request and moves on to the next file", async () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi"), fileOf("b.dmg"), fileOf("c.deb")])
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
    calls[0].reject(new Error("boom"))
    await settle()
    expect(queue.getSnapshot().items[0].error).toMatchObject({ code: "UNKNOWN" })

    queue.retry("q1")
    calls[1].resolve(uploaded("a.msi"))
    await settle()
    expect(queue.getSnapshot().items[0].status).toBe("done")
  })

  it("uses the latest hooks after configure", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.configure({ savedHolder: (os) => (os === "macos" ? { fileId: "m", name: "mac.dmg" } : null) })
    queue.add([fileOf("new.dmg")])

    expect(calls).toHaveLength(0)
  })

  it("dispose aborts every running upload", () => {
    const { upload, calls } = fakeUpload()
    const { queue } = queueWith(upload)

    queue.add([fileOf("a.msi"), fileOf("b.dmg")])
    queue.dispose()

    expect(calls.every((call) => call.options.signal?.aborted)).toBe(true)
  })
})
