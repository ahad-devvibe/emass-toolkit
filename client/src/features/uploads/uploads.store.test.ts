import { describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import type { UploadOptions } from "@/lib/api/upload"
import type { HashFn } from "@/lib/hash/hash-file"
import type { CheckRequest, FileVerdict } from "@/pages/ReleaseEditor/file-check"
import type { UploadCreateInput, UploadSession } from "@/pages/Releases/releases.api"
import type { FileIssue, PublishJob, ReleaseFileItem } from "@/pages/Releases/releases.model"
import type { FileHandle } from "./file-source"
import { memoryPersistence, type UploadRecord } from "./upload-persistence"
import { createUploadsStore, type Connectivity, type UploadsApi } from "./uploads.store"

const PART = 4
const fileOf = (name: string, size = 10, lastModified = 1) => new File([new Uint8Array(size)], name, { lastModified })
const uploaded = (name: string): ReleaseFileItem => ({ id: `id-${name}`, name, kind: "sdk", os: "windows", contentType: "application/octet-stream", sizeBytes: 10, sha256: `h-${name}`, createdAt: "2026-10-22T00:00:00.000Z", format: null, detectedVersions: [], blockedBy: [], warnings: [] })

const noVersion: FileIssue = { code: "NO_VERSION", message: "No version found in this file's name or contents." }
const mismatch: FileIssue = { code: "VERSION_MISMATCH", message: "This installer says version 1.0.0; this release is 2.0.0." }
const blockedError = (reasons: FileIssue[]) => new ApiRequestError(409, "FILE_BLOCKED", reasons[0].message, {}, { reasons })
const networkError = () => new ApiRequestError(0, "NETWORK_ERROR", "Can't reach the server.")
const allowed = (warnings: FileIssue[] = []): FileVerdict => ({ status: "ALLOWED", format: "OTHER", versions: [], warnings })
const picked = (...files: File[]) => files.map((file) => ({ file, handle: null }))

type PartCall = { releaseId: string; uploadId: string; n: number; part: Blob; options: UploadOptions; resolve: () => void; reject: (error: unknown) => void }

/**
 * A server in memory: sessions keyed by hash (creating again returns the same
 * one, with its parts), parts that either store themselves at once ("auto")
 * or wait for the test ("manual"), and complete that saves the file.
 */
type FakeOptions = { parts?: "auto" | "manual"; verdict?: (file: File, request: CheckRequest) => Promise<FileVerdict> }

function fakeApi({ parts = "auto", verdict = async () => allowed() }: FakeOptions = {}) {
  const sessions = new Map<string, UploadSession>()
  const calls: PartCall[] = []
  let created = 0

  const store = (uploadId: string, n: number) => {
    for (const session of sessions.values()) if (session.uploadId === uploadId) session.partsDone = Math.max(session.partsDone, n)
    return [...sessions.values()].find((session) => session.uploadId === uploadId)!
  }

  const api = {
    check: vi.fn((_releaseId: string, file: File, request: CheckRequest) => verdict(file, { ...request })),
    create: vi.fn(async (_releaseId: string, input: UploadCreateInput) => {
      const existing = sessions.get(input.sha256)
      if (existing) return { ...existing }
      const session = { uploadId: `u${++created}`, name: input.name, size: input.size, sha256: input.sha256, partSize: PART, partsDone: 0 }
      sessions.set(input.sha256, session)
      return { ...session }
    }),
    putPart: vi.fn(
      (releaseId: string, uploadId: string, n: number, part: Blob, options: UploadOptions) =>
        new Promise<UploadSession>((resolve, reject) => {
          const call = { releaseId, uploadId, n, part, options, resolve: () => resolve({ ...store(uploadId, n) }), reject }
          if (parts === "auto") call.resolve()
          else calls.push(call)
        }),
    ),
    complete: vi.fn(async (_releaseId: string, uploadId: string) => {
      const session = [...sessions.values()].find((candidate) => candidate.uploadId === uploadId)!
      sessions.delete(session.sha256)
      return uploaded(session.name)
    }),
    abort: vi.fn(async (_releaseId: string, uploadId: string) => {
      for (const [sha, session] of sessions) if (session.uploadId === uploadId) sessions.delete(sha)
    }),
    findUploaded: vi.fn<UploadsApi["findUploaded"]>(async () => null),
    publishJobs: vi.fn(async () => [] as Awaited<ReturnType<UploadsApi["publishJobs"]>>),
    publishStatus: vi.fn(async () => ({ job: null, status: "in_review" as const })),
  } satisfies UploadsApi
  return { api, calls, sessions }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function storeWith(fake = fakeApi(), { online = true, persistence = memoryPersistence(), reopen, readIfGranted = async () => null, concurrency }: { online?: boolean; persistence?: ReturnType<typeof memoryPersistence>; reopen?: (handle: FileHandle) => Promise<File>; readIfGranted?: (handle: FileHandle) => Promise<File | null>; concurrency?: number } = {}) {
  let id = 0
  let clock = 0
  const hash = vi.fn<HashFn>(async (file: File) => `h-${file.name}`)
  // Waits resolve at once; the test reads what was waited for
  const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
  let backOnline: () => void = () => {}
  const connectivity: Connectivity = {
    isOnline: () => online,
    whenOnline: () =>
      new Promise((resolve) => {
        backOnline = () => {
          online = true
          resolve()
        }
      }),
  }
  const scheduled: (() => void)[] = []
  const store = createUploadsStore({
    api: fake.api,
    hash,
    persistence,
    connectivity,
    reopen,
    readIfGranted,
    concurrency,
    sleep,
    schedule: (run) => {
      scheduled.push(run)
      return () => scheduled.splice(scheduled.indexOf(run), 1)
    },
    newId: () => `q${++id}`,
    now: () => (clock += 1000),
  })
  const onUploaded = vi.fn()
  store.registerRelease("r1", { onUploaded })
  const tick = async () => {
    const due = scheduled.splice(0)
    for (const run of due) run()
    await settle()
  }
  return { store, hash, sleep, onUploaded, persistence, backOnline: () => backOnline(), tick, ...fake }
}

const itemOf = (store: ReturnType<typeof storeWith>["store"], localId = "q1") => store.getSnapshot().items.find((item) => item.localId === localId)!

describe("uploads store: the pipeline", () => {
  it("checks, hashes, checks with the hash, then sends every part in order and completes", async () => {
    const { store, api, hash, onUploaded, persistence } = storeWith()
    await store.start({ id: "dev1", role: "DEV" })

    store.add("r1", "EMASS v1.0.0", picked(fileOf("a.msi")))
    await settle()

    expect(api.check.mock.calls.map(([, , request]) => request.sha256)).toEqual([undefined, "h-a.msi"])
    expect(hash).toHaveBeenCalledOnce()
    expect(api.create).toHaveBeenCalledWith("r1", { name: "a.msi", size: 10, sha256: "h-a.msi", contentType: undefined, kind: "sdk", os: "windows", replace: undefined })
    expect(api.putPart.mock.calls.map(([, , n, part]) => [n, part.size])).toEqual([[1, 4], [2, 4], [3, 2]])
    expect(itemOf(store)).toMatchObject({ status: "done", result: { id: "id-a.msi" } })
    expect(onUploaded).toHaveBeenCalledOnce()
    // Finished uploads leave nothing to resume
    expect(persistence.records.size).toBe(0)
  })

  it("never hashes or uploads a file whose versions are blocked", async () => {
    const { store, api, hash } = storeWith(fakeApi({ verdict: async () => { throw blockedError([mismatch]) } }))

    store.add("r1", "", picked(fileOf("old.exe")))
    await settle()

    expect(hash).not.toHaveBeenCalled()
    expect(api.create).not.toHaveBeenCalled()
    expect(itemOf(store)).toMatchObject({ status: "blocked", blockedBy: [mismatch] })
  })

  it("never opens a session for a file blocked once its hash is known", async () => {
    const same: FileIssue = { code: "SAME_CONTENT", message: 'Identical to "a.msi" in v1.0.0.' }
    const { store, api } = storeWith(fakeApi({ verdict: async (_file, request) => { if (request.sha256) throw blockedError([same]); return allowed() } }))

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(api.create).not.toHaveBeenCalled()
    expect(itemOf(store)).toMatchObject({ status: "blocked", blockedBy: [same] })
  })

  it("shows the check's warnings and size-weighted progress while parts go up", async () => {
    const { store, calls } = storeWith(fakeApi({ parts: "manual", verdict: async () => allowed([noVersion]) }))

    store.add("r1", "", picked(fileOf("notes.txt")))
    await settle()
    expect(itemOf(store)).toMatchObject({ status: "uploading", warnings: [noVersion], loaded: 0 })

    calls[0].resolve()
    await settle()
    calls[1].options.onProgress?.(2, 4)
    expect(itemOf(store).loaded).toBe(6)
    calls[1].resolve()
    await settle()
    calls[2].resolve()
    await settle()
    expect(itemOf(store).status).toBe("done")
  })

  it("blocks a file the server refuses at complete (a race with another upload)", async () => {
    const fake = fakeApi()
    fake.api.complete.mockRejectedValueOnce(blockedError([mismatch]))
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(itemOf(store).status).toBe("blocked")
  })

  it("uploads undetected files right away, unmapped", async () => {
    const { store, api } = storeWith()

    store.add("r1", "", picked(fileOf("guide.pdf"), fileOf("mystery.zip")))
    await settle()

    expect(api.create.mock.calls.map(([, input]) => [input.kind, input.os])).toEqual([["documentation", null], [null, null]])
  })
})

describe("uploads store: network trouble", () => {
  it("retries the same part after 1, 2 then 5 seconds, showing when", async () => {
    const fake = fakeApi()
    fake.api.putPart.mockRejectedValueOnce(networkError()).mockRejectedValueOnce(networkError()).mockRejectedValueOnce(new ApiRequestError(502, "UPLOAD_FAILED", "Storage"))
    const { store, sleep, api } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 5000])
    expect(api.putPart.mock.calls.map(([, , n]) => n)).toEqual([1, 1, 1, 1, 2, 3])
    expect(itemOf(store).status).toBe("done")
  })

  it("waits for the browser to come back online instead of a timer", async () => {
    const fake = fakeApi()
    fake.api.putPart.mockRejectedValueOnce(networkError())
    const { store, sleep, backOnline } = storeWith(fake, { online: false })

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()
    expect(itemOf(store)).toMatchObject({ status: "waiting", retryAt: null })
    expect(sleep).not.toHaveBeenCalled()

    backOnline()
    await settle()
    expect(itemOf(store).status).toBe("done")
  })

  it("jumps to the part the server expects", async () => {
    const fake = fakeApi()
    fake.sessions.set("h-a.msi", { uploadId: "u9", name: "a.msi", size: 10, sha256: "h-a.msi", partSize: PART, partsDone: 0 })
    fake.api.putPart.mockRejectedValueOnce(new ApiRequestError(409, "PART_OUT_OF_ORDER", "Send part 3", {}, { expected: 3 }))
    const { store, api } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(api.putPart.mock.calls.map(([, , n]) => n)).toEqual([1, 3])
    expect(itemOf(store).status).toBe("done")
  })

  it("opens a new session once when the server lost the old one", async () => {
    const fake = fakeApi()
    const gone = () => new ApiRequestError(404, "UPLOAD_NOT_FOUND", "gone")
    fake.api.putPart.mockRejectedValueOnce(gone())
    const { store, api } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()
    expect(api.create).toHaveBeenCalledTimes(2)
    expect(itemOf(store).status).toBe("done")

    fake.api.putPart.mockRejectedValueOnce(gone()).mockRejectedValueOnce(gone())
    store.add("r1", "", picked(fileOf("b.dmg")))
    await settle()
    expect(itemOf(store, "q2")).toMatchObject({ status: "failed", error: { code: "UPLOAD_NOT_FOUND" } })
  })

  it("finishes an upload whose complete response was lost but whose file landed", async () => {
    const fake = fakeApi()
    fake.api.complete.mockRejectedValueOnce(networkError())
    let lookups = 0
    fake.api.findUploaded.mockImplementation(async () => (++lookups === 3 ? uploaded("a.pkg") : null))
    const { store, onUploaded } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.pkg")))
    await settle()

    expect(fake.api.findUploaded).toHaveBeenCalledTimes(3)
    expect(fake.api.findUploaded).toHaveBeenCalledWith("r1", "h-a.pkg")
    expect(itemOf(store)).toMatchObject({ status: "done", result: { id: "id-a.pkg" } })
    expect(onUploaded).toHaveBeenCalledOnce()
  })

  it("completes again after another complete held the upload and saved nothing", async () => {
    const fake = fakeApi()
    fake.api.complete.mockRejectedValueOnce(new ApiRequestError(409, "UPLOAD_COMPLETING", "busy"))
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.pkg")))
    await settle()

    expect(fake.api.complete).toHaveBeenCalledTimes(2)
    expect(itemOf(store).status).toBe("done")
  })

  it("treats a retry refused as the same bytes as done, when they're in this release", async () => {
    const same: FileIssue = { code: "SAME_CONTENT", message: 'Already in this release as "a.pkg".' }
    let landed = false
    const fake = fakeApi({ verdict: async (_file, request) => { if (request.sha256 && landed) throw blockedError([same]); return allowed() } })
    fake.api.complete.mockRejectedValueOnce(new Error("boom"))
    fake.api.findUploaded.mockImplementation(async () => (landed ? uploaded("a.pkg") : null))
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.pkg")))
    await settle()
    expect(itemOf(store).status).toBe("failed")

    landed = true
    store.retry("q1")
    await settle()
    expect(itemOf(store).status).toBe("done")
  })

  it("still blocks identical bytes that are in another release", async () => {
    const same: FileIssue = { code: "SAME_CONTENT", message: 'Identical to "a.pkg" in v1.0.0.' }
    const fake = fakeApi({ verdict: async (_file, request) => { if (request.sha256) throw blockedError([same]); return allowed() } })
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.pkg")))
    await settle()

    expect(fake.api.findUploaded).toHaveBeenCalledOnce()
    expect(itemOf(store)).toMatchObject({ status: "blocked", blockedBy: [same] })
  })

  it("hashes again on retry only when the server saw other bytes", async () => {
    const fake = fakeApi()
    fake.api.complete.mockRejectedValueOnce(new Error("boom")).mockRejectedValueOnce(new ApiRequestError(422, "CHECKSUM_MISMATCH", "changed"))
    const { store, hash } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()
    expect(itemOf(store).error).toMatchObject({ code: "UNKNOWN" })
    store.retry("q1")
    await settle()
    expect(hash).toHaveBeenCalledOnce()
    expect(itemOf(store).error).toMatchObject({ code: "CHECKSUM_MISMATCH", message: "The file changed while uploading. Retry to check it again." })

    store.retry("q1")
    await settle()
    expect(hash).toHaveBeenCalledTimes(2)
    expect(itemOf(store).status).toBe("done")
  })
})

describe("uploads store: pause, cancel and slots", () => {
  it("pauses by aborting the part, then resumes from the server's count without checking again", async () => {
    const { store, calls, api, hash } = storeWith(fakeApi({ parts: "manual" }))

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()
    calls[0].resolve()
    await settle()
    store.pause("q1")
    expect(calls[1].options.signal?.aborted).toBe(true)
    calls[1].reject(new ApiRequestError(0, "CANCELLED", "cancelled"))
    await settle()
    expect(itemOf(store)).toMatchObject({ status: "paused", uploadId: "u1" })

    store.resume("q1")
    await settle()
    expect(api.check).toHaveBeenCalledTimes(2)
    expect(hash).toHaveBeenCalledOnce()
    // The server had part 1: part 2 goes next
    expect(calls[2].n).toBe(2)
  })

  it("cancels by aborting the part and the server's session, then starts the next file", async () => {
    const { store, calls, api } = storeWith(fakeApi({ parts: "manual" }))

    store.add("r1", "", picked(fileOf("a.msi"), fileOf("b.dmg"), fileOf("c.deb")))
    await settle()
    store.cancel("q1")
    expect(calls[0].options.signal?.aborted).toBe(true)
    calls[0].reject(new ApiRequestError(0, "CANCELLED", "cancelled"))
    await settle()

    expect(api.abort).toHaveBeenCalledWith("r1", "u1")
    expect(store.getSnapshot().items.map((item) => item.status)).toEqual(["cancelled", "uploading", "uploading"])
  })

  it("cancels while hashing by aborting the hash", async () => {
    const { store, hash, api } = storeWith()
    let hashSignal: AbortSignal | undefined
    hash.mockImplementation((_file, options) => {
      hashSignal = options?.signal
      return new Promise(() => {})
    })

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()
    store.cancel("q1")

    expect(hashSignal?.aborted).toBe(true)
    expect(itemOf(store).status).toBe("cancelled")
    expect(api.create).not.toHaveBeenCalled()
  })

  it("runs files up to the slot count across releases, and starts the next when one finishes", async () => {
    const { store, calls, api } = storeWith(fakeApi({ parts: "manual" }), { concurrency: 2 })

    store.add("r1", "", picked(fileOf("a.msi", 4)))
    store.add("r2", "", picked(fileOf("b.dmg", 4), fileOf("c.deb", 4)))
    await settle()
    expect(calls.map((call) => call.releaseId)).toEqual(["r1", "r2"])

    calls[0].resolve()
    await settle()
    expect(api.create.mock.calls.map(([, input]) => input.name)).toEqual(["a.msi", "b.dmg", "c.deb"])
  })
})

describe("uploads store: platforms", () => {
  it("holds a file whose detected platform a saved file of its release already has", async () => {
    const { store, api } = storeWith()
    store.registerRelease("r1", { savedHolder: (os) => (os === "windows" ? { fileId: "f1", name: "old.msi" } : null) })

    store.add("r1", "", picked(fileOf("new.msi"), fileOf("guide.pdf")))
    await settle()

    expect(api.create.mock.calls.map(([, input]) => input.name)).toEqual(["guide.pdf"])
    expect(itemOf(store)).toMatchObject({ status: "conflict", holder: { fileId: "f1", name: "old.msi" } })
  })

  it("holds the second of two builds for one platform, within a release only", async () => {
    const { store } = storeWith(fakeApi({ parts: "manual" }))

    store.add("r1", "", picked(fileOf("a-win.msi"), fileOf("b-win.exe")))
    store.add("r2", "", picked(fileOf("c-win.msi")))
    await settle()

    expect(store.getSnapshot().items.map((item) => item.status)).toEqual(["uploading", "conflict", "uploading"])
  })

  it("replaces the saved holder on request, checking against the file it replaces", async () => {
    const { store, api } = storeWith()
    store.registerRelease("r1", { savedHolder: () => ({ fileId: "f1", name: "old.msi" }) })

    store.add("r1", "", picked(fileOf("new.msi")))
    store.replace("q1")
    await settle()

    expect(api.check.mock.calls[0][2]).toMatchObject({ replace: "f1" })
    expect(api.create.mock.calls[0][1]).toMatchObject({ kind: "sdk", os: "windows", replace: "f1" })
  })

  it("uploads a held file once it's mapped somewhere free", async () => {
    const { store, api } = storeWith()
    store.registerRelease("r1", { savedHolder: (os) => (os === "windows" ? { fileId: "f1", name: "old.msi" } : null) })

    store.add("r1", "", picked(fileOf("new.msi")))
    store.map("q1", "documentation", null)
    await settle()

    expect(api.create.mock.calls[0][1]).toMatchObject({ kind: "documentation", os: null })
  })

  it("turns a server PLATFORM_TAKEN into a held conflict", async () => {
    const fake = fakeApi()
    fake.api.create.mockRejectedValueOnce(new ApiRequestError(409, "PLATFORM_TAKEN", "taken", {}, { fileId: "f9" }))
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(itemOf(store)).toMatchObject({ status: "conflict", holder: { fileId: "f9" } })
  })
})

describe("uploads store: refreshes and sign-outs", () => {
  const record = (overrides: Partial<UploadRecord> = {}): UploadRecord => ({ localId: "old", userId: "dev1", releaseId: "r1", releaseLabel: "EMASS v1.0.0", name: "a.pkg", sizeBytes: 10, lastModified: 7, sha256: "h-a.pkg", uploadId: "u5", kind: "sdk", os: "macos", replaceFileId: null, warnings: [], handle: null, ...overrides })

  it("remembers an unfinished upload, with its hash and session", async () => {
    const persistence = memoryPersistence()
    const { store } = storeWith(fakeApi({ parts: "manual" }), { persistence })
    await store.start({ id: "dev1", role: "DEV" })

    store.add("r1", "EMASS v1.0.0", picked(fileOf("a.msi")))
    await settle()

    expect(persistence.records.get("q1")).toMatchObject({ userId: "dev1", releaseLabel: "EMASS v1.0.0", sha256: "h-a.msi", uploadId: "u1" })
  })

  it("brings this user's uploads back waiting for their file, and drops anyone else's", async () => {
    const persistence = memoryPersistence([record(), record({ localId: "theirs", userId: "dev2" })])
    const { store } = storeWith(fakeApi(), { persistence })

    await store.start({ id: "dev1", role: "DEV" })

    expect(store.getSnapshot().items).toEqual([expect.objectContaining({ localId: "old", status: "needsFile", uploadId: "u5" })])
    expect([...persistence.records.keys()]).toEqual(["old"])
  })

  it("resumes with the stored handle, continuing the server's session", async () => {
    const handle = { kind: "file", name: "a.pkg", getFile: async () => fileOf("a.pkg", 10, 7) } as FileHandle
    const fake = fakeApi()
    fake.sessions.set("h-a.pkg", { uploadId: "u5", name: "a.pkg", size: 10, sha256: "h-a.pkg", partSize: PART, partsDone: 2 })
    const { store, api, hash } = storeWith(fake, { persistence: memoryPersistence([record({ handle })]), reopen: (stored) => stored.getFile() })
    await store.start({ id: "dev1", role: "DEV" })

    await store.resumeWithHandle("old")
    await settle()

    expect(hash).not.toHaveBeenCalled()
    expect(api.check).not.toHaveBeenCalled()
    expect(api.putPart.mock.calls.map(([, uploadId, n]) => [uploadId, n])).toEqual([["u5", 3]])
    expect(itemOf(store, "old").status).toBe("done")
  })

  it("starts over when the file behind the handle changed", async () => {
    const handle = { kind: "file", name: "a.pkg", getFile: async () => fileOf("a.pkg", 10, 99) } as FileHandle
    const fake = fakeApi()
    const { store, api, hash } = storeWith(fake, { persistence: memoryPersistence([record({ handle })]), reopen: (stored) => stored.getFile() })
    await store.start({ id: "dev1", role: "DEV" })

    await store.resumeWithHandle("old")
    await settle()

    expect(api.abort).toHaveBeenCalledWith("r1", "u5")
    expect(hash).toHaveBeenCalledOnce()
    expect(itemOf(store, "old").status).toBe("done")
  })

  it("asks for the file when the handle can't be read", async () => {
    const handle = { kind: "file", name: "a.pkg", getFile: async () => fileOf("a.pkg") } as FileHandle
    const { store } = storeWith(fakeApi(), { persistence: memoryPersistence([record({ handle })]), reopen: async () => { throw new DOMException("no", "NotAllowedError") } })
    await store.start({ id: "dev1", role: "DEV" })

    await store.resumeWithHandle("old")

    expect(itemOf(store, "old")).toMatchObject({ status: "needsFile", error: { code: "FILE_UNAVAILABLE" } })
  })

  it("resumes with a picked file only if it's the same: name, size, then hash", async () => {
    const fake = fakeApi()
    fake.sessions.set("h-a.pkg", { uploadId: "u5", name: "a.pkg", size: 10, sha256: "h-a.pkg", partSize: PART, partsDone: 1 })
    const { store, api, hash } = storeWith(fake, { persistence: memoryPersistence([record()]) })
    await store.start({ id: "dev1", role: "DEV" })

    store.resumeWithFile("old", fileOf("other.pkg"))
    expect(itemOf(store, "old")).toMatchObject({ status: "needsFile", error: { code: "WRONG_FILE" } })

    store.resumeWithFile("old", fileOf("a.pkg", 10, 123))
    await settle()
    expect(hash).toHaveBeenCalledOnce()
    expect(api.abort).not.toHaveBeenCalled()
    expect(api.putPart.mock.calls.map(([, uploadId, n]) => [uploadId, n])).toEqual([["u5", 2], ["u5", 3]])
  })

  it("starts a picked file over when its bytes differ", async () => {
    const fake = fakeApi()
    const { store, api, hash } = storeWith(fake, { persistence: memoryPersistence([record({ sha256: "h-something-else" })]) })
    await store.start({ id: "dev1", role: "DEV" })

    store.resumeWithFile("old", fileOf("a.pkg"))
    await settle()

    expect(hash).toHaveBeenCalledOnce()
    expect(api.abort).toHaveBeenCalledWith("r1", "u5")
    expect(api.check.mock.calls.at(-1)?.[2]).toMatchObject({ sha256: "h-a.pkg" })
    expect(itemOf(store, "old").status).toBe("done")
  })

  it("stops and forgets everything on sign-out", async () => {
    const persistence = memoryPersistence()
    const { store, calls } = storeWith(fakeApi({ parts: "manual" }), { persistence })
    await store.start({ id: "dev1", role: "DEV" })
    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    store.stop()
    await settle()

    expect(calls[0].options.signal?.aborted).toBe(true)
    expect(store.getSnapshot().items).toEqual([])
    expect(persistence.records.size).toBe(0)
  })
})

describe("uploads store: publish jobs", () => {
  const job = (phase: PublishJob["phase"]): PublishJob => ({ phase, filesTotal: 2, filesDone: 1, percent: 50, error: null, startedAt: "2026-10-28T00:00:00.000Z", finishedAt: null })
  const entry = (releaseId: string, phase: PublishJob["phase"]) => ({ releaseId, version: "1.0.0", productName: "EMASS", job: job(phase) })

  it("follows a job with one request per tick, then reports it settled once", async () => {
    const { store, api, tick } = storeWith()
    const settled = vi.fn()
    store.onPublishSettled("r1", settled)
    store.trackPublish("r1", "", job("copying"))
    store.trackPublish("r2", "", job("copying"))

    api.publishJobs.mockResolvedValue([entry("r1", "copying"), entry("r2", "copying")])
    await tick()
    expect(api.publishJobs).toHaveBeenCalledOnce()
    expect(store.getSnapshot().publishes[0].releaseLabel).toBe("EMASS v1.0.0")

    api.publishJobs.mockResolvedValue([entry("r1", "done"), entry("r2", "copying")])
    await tick()
    await tick()
    expect(settled).toHaveBeenCalledOnce()
    expect(settled).toHaveBeenCalledWith(job("done"))
  })

  it("marks a job the server lost while still in review as interrupted", async () => {
    const { store, api, tick } = storeWith()
    store.trackPublish("r1", "", job("copying"))
    api.publishStatus.mockResolvedValue({ job: null, status: "in_review" })

    await tick()

    expect(store.getSnapshot().publishes[0]).toMatchObject({ job: null, interrupted: true })
  })

  it("treats a job that expired after publishing as done", async () => {
    const { store, api, tick } = storeWith()
    const settled = vi.fn()
    store.onPublishSettled("r1", settled)
    store.trackPublish("r1", "", job("copying"))
    api.publishStatus.mockResolvedValue({ job: null, status: "published" } as never)

    await tick()

    expect(settled).toHaveBeenCalledWith(expect.objectContaining({ phase: "done", percent: 100 }))
  })

  it("picks up running jobs when an admin's page opens", async () => {
    const { store, api } = storeWith()
    api.publishJobs.mockResolvedValue([entry("r1", "copying"), entry("r2", "done")])

    await store.start({ id: "admin1", role: "ADMIN" })

    expect(store.getSnapshot().publishes.map((item) => item.releaseId)).toEqual(["r1"])
  })
})

describe("uploads store: settled jobs nobody watches", () => {
  const job = (phase: PublishJob["phase"]): PublishJob => ({ phase, filesTotal: 1, filesDone: 1, percent: 100, error: null, startedAt: "2026-10-28T00:00:00.000Z", finishedAt: null })

  it("goes to the release page while it's open, otherwise to the panel", async () => {
    const { store, api, tick } = storeWith()
    const page = vi.fn()
    const panel = vi.fn()
    store.onUnwatchedPublishSettled(panel)
    const leave = store.onPublishSettled("r1", page)
    store.trackPublish("r1", "", job("copying"))
    store.trackPublish("r2", "", job("copying"))
    api.publishJobs.mockResolvedValue([
      { releaseId: "r1", version: "1.0.0", productName: "EMASS", job: job("done") },
      { releaseId: "r2", version: "2.0.0", productName: "EMASS", job: job("done") },
    ])

    await tick()
    leave()

    expect(page).toHaveBeenCalledOnce()
    expect(panel).toHaveBeenCalledOnce()
    expect(panel).toHaveBeenCalledWith("r2", job("done"))
  })
})

describe("uploads store: deleting a release", () => {
  it("pauses the release's uploads, then forgets them once it's deleted", async () => {
    const persistence = memoryPersistence()
    const { store, calls, api } = storeWith(fakeApi({ parts: "manual" }), { persistence })
    await store.start({ id: "dev1", role: "DEV" })
    store.add("r1", "", picked(fileOf("a.msi")))
    store.add("r2", "", picked(fileOf("b.dmg")))
    await settle()

    store.pauseRelease("r1")
    expect(calls[0].options.signal?.aborted).toBe(true)
    expect(itemOf(store).status).toBe("paused")
    store.forgetRelease("r1")
    await settle()

    expect(store.getSnapshot().items.map((item) => item.releaseId)).toEqual(["r2"])
    expect([...persistence.records.values()].map((record) => record.releaseId)).toEqual(["r2"])
    // The server cancelled the session with the release; nothing to abort
    expect(api.abort).not.toHaveBeenCalled()
  })

  it("resumes what it paused if the delete fails", async () => {
    const { store, calls } = storeWith(fakeApi({ parts: "manual" }))
    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()
    calls[0].resolve()
    await settle()

    store.pauseRelease("r1")
    store.resumeRelease("r1")
    await settle()

    expect(itemOf(store).status).toBe("uploading")
    expect(calls.at(-1)?.n).toBe(2)
  })
})

describe("uploads store: a new release version", () => {
  const wrongVersion: FileIssue = { code: "VERSION_MISMATCH", message: "This installer says version 1.135.0; this release is 1.0.0." }
  const same: FileIssue = { code: "SAME_CONTENT", message: 'Identical to "a.exe" in v0.9.0.' }

  it("checks version-blocked files again, without hashing, and uploads them once allowed", async () => {
    let releaseVersion = "1.0.0"
    const fake = fakeApi({ verdict: async (file, request) => (request.sha256 && releaseVersion !== "1.135.0" && file.name !== "same.pkg" ? Promise.reject(blockedError([wrongVersion])) : request.sha256 && file.name === "same.pkg" ? Promise.reject(blockedError([same])) : allowed()) })
    const { store, hash, api } = storeWith(fake)
    store.add("r1", "", picked(fileOf("a.exe"), fileOf("same.pkg")))
    store.add("r2", "", picked(fileOf("other.exe")))
    await settle()
    expect(store.getSnapshot().items.map((item) => item.status)).toEqual(["blocked", "blocked", "blocked"])

    releaseVersion = "1.135.0"
    store.recheckRelease("r1")
    await settle()

    expect(store.getSnapshot().items.map((item) => [item.name, item.status])).toEqual([["a.exe", "done"], ["same.pkg", "blocked"], ["other.exe", "blocked"]])
    expect(hash).toHaveBeenCalledTimes(3)
    expect(api.create.mock.calls.map(([, input]) => input.name)).toEqual(["a.exe"])
  })

  it("lets Check again retry a version block only", async () => {
    const fake = fakeApi({ verdict: async (_file, request) => (request.sha256 ? Promise.reject(blockedError([same])) : allowed()) })
    const { store, api } = storeWith(fake)
    store.add("r1", "", picked(fileOf("same.exe")))
    await settle()

    store.retry("q1")
    await settle()

    expect(itemOf(store).status).toBe("blocked")
    // The refused retry never reached the check again
    expect(api.check).toHaveBeenCalledTimes(2)
  })
})

describe("uploads store: refreshes with several files", () => {
  const handleFor = (file: File) => ({ kind: "file", name: file.name, getFile: async () => file }) as FileHandle
  const files = [fileOf("a.msi", 10, 1), fileOf("b.dmg", 10, 1), fileOf("c.deb", 10, 1), fileOf("guide.pdf", 10, 1)]

  it("uploads three files at a time by default", async () => {
    const { store } = storeWith(fakeApi({ parts: "manual" }))
    store.add("r1", "", picked(...files))
    await settle()
    expect(store.getSnapshot().items.map((item) => item.status)).toEqual(["uploading", "uploading", "uploading", "queued"])
  })

  /** A tab with 3 files uploading and 1 waiting, then a fresh store over the same saved records. */
  async function afterRefresh(readIfGranted: (handle: FileHandle) => Promise<File | null>, reopen?: (handle: FileHandle) => Promise<File>) {
    const persistence = memoryPersistence()
    const before = storeWith(fakeApi({ parts: "manual" }), { persistence })
    await before.store.start({ id: "dev1", role: "DEV" })
    before.store.add("r1", "", files.map((file) => ({ file, handle: handleFor(file) })))
    await settle()
    before.calls[0].resolve()
    await settle()

    // The server kept its sessions and part counts across the refresh
    const fake = fakeApi()
    for (const [sha, session] of before.sessions) fake.sessions.set(sha, { ...session })
    const after = storeWith(fake, { persistence, readIfGranted, reopen })
    await after.store.start({ id: "dev1", role: "DEV" })
    await settle()
    return after
  }

  it("carries on by itself, waiting file included, where the browser still allows reading the files", async () => {
    const after = await afterRefresh(async (handle) => handle.getFile())

    expect(after.store.getSnapshot().items.map((item) => [item.name, item.status])).toEqual([
      ["a.msi", "done"],
      ["b.dmg", "done"],
      ["c.deb", "done"],
      ["guide.pdf", "done"],
    ])
    // a.msi had part 1 stored: it went on from part 2, with no new check or hash
    expect(after.api.putPart.mock.calls.filter(([, , , part]) => part.size).map(([, uploadId, n]) => [uploadId, n])[0]).toEqual(["u1", 2])
    expect(after.hash.mock.calls.map(([file]) => file.name)).toEqual(["guide.pdf"])
  })

  it("waits for a click where the browser would ask", async () => {
    const after = await afterRefresh(async () => null)

    expect(after.store.getSnapshot().items.map((item) => item.status)).toEqual(["needsFile", "needsFile", "needsFile", "needsFile"])
    expect(after.store.getSnapshot().items.find((item) => item.name === "guide.pdf")?.sha256).toBeNull()
  })

  it("resumes them all with one click", async () => {
    const reopen = vi.fn(async (handle: FileHandle) => handle.getFile())
    const after = await afterRefresh(async () => null, reopen)

    await after.store.resumeAll()
    await settle()

    expect(reopen).toHaveBeenCalledTimes(4)
    expect(after.store.getSnapshot().items.every((item) => item.status === "done")).toBe(true)
  })

  it("starts a file over when it changed on disk since the refresh", async () => {
    const after = await afterRefresh(async (handle) => (handle.name === "a.msi" ? fileOf("a.msi", 10, 99) : null))

    expect(after.api.abort).toHaveBeenCalledWith("r1", "u1")
    expect(after.store.getSnapshot().items[0].status).toBe("done")
  })

  it("takes the interrupted files picked again at once, matched by name and size", async () => {
    const after = await afterRefresh(async () => null)

    const unmatched = after.store.resumeWithFiles([{ file: fileOf("b.dmg", 10, 5), handle: null }, { file: fileOf("guide.pdf", 10, 5), handle: null }, { file: fileOf("other.zip"), handle: null }])
    await settle()

    expect(unmatched).toEqual(["other.zip"])
    expect(after.store.getSnapshot().items.map((item) => [item.name, item.status])).toEqual([
      ["a.msi", "needsFile"],
      ["b.dmg", "done"],
      ["c.deb", "needsFile"],
      ["guide.pdf", "done"],
    ])
  })

  it("cancels every interrupted upload at once", async () => {
    const after = await afterRefresh(async () => null)

    after.store.cancelInterrupted("r1")

    expect(after.store.getSnapshot().items.every((item) => item.status === "cancelled")).toBe(true)
    expect(after.api.abort).toHaveBeenCalledTimes(3)
  })
})

describe("uploads store: how long to keep trying", () => {
  const serverDown = () => new ApiRequestError(502, "UPLOAD_FAILED", "Unable to upload file")

  it("says why it's waiting: the server or the connection", async () => {
    const fake = fakeApi({ parts: "manual" })
    fake.api.putPart.mockRejectedValueOnce(serverDown())
    const seen: unknown[] = []
    const { store, sleep } = storeWith(fake)
    sleep.mockImplementation(async () => {
      seen.push(itemOf(store).retryReason)
    })

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(seen).toEqual([{ kind: "server", message: "Unable to upload file", attempt: 1 }])
  })

  it("fails with the reason after six server errors in a row, and Retry carries on", async () => {
    const fake = fakeApi()
    for (let i = 0; i < 6; i++) fake.api.putPart.mockRejectedValueOnce(serverDown())
    const { store, api } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(itemOf(store)).toMatchObject({ status: "failed", error: { code: "SERVER_KEEPS_FAILING" } })
    expect(itemOf(store).error?.message).toContain("Unable to upload file")
    expect(api.putPart).toHaveBeenCalledTimes(6)

    store.retry("q1")
    await settle()
    expect(itemOf(store).status).toBe("done")
  })

  it("keeps going when the server recovers before that, starting the count again", async () => {
    const fake = fakeApi()
    // Part 1 fails 5 times then lands; part 2 fails 5 more times: never 6 in a row
    const steps = [...Array(5).fill("fail"), "ok", ...Array(5).fill("fail")]
    fake.api.putPart.mockImplementation(async (_releaseId, uploadId, n) => {
      if (steps.shift() === "fail") throw serverDown()
      return { uploadId, name: "a.msi", size: 10, sha256: "h-a.msi", partSize: PART, partsDone: n }
    })
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(itemOf(store).error).toBeNull()
    expect(itemOf(store).status).toBe("done")
  })

  it("never gives up on a lost connection", async () => {
    const fake = fakeApi()
    for (let i = 0; i < 10; i++) fake.api.putPart.mockRejectedValueOnce(networkError())
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(itemOf(store).status).toBe("done")
  })

  it("fails at once when storage refuses the upload", async () => {
    const fake = fakeApi()
    fake.api.complete.mockRejectedValueOnce(new ApiRequestError(409, "UPLOAD_REJECTED", "Storage refused this upload. Upload the file again."))
    const { store } = storeWith(fake)

    store.add("r1", "", picked(fileOf("a.msi")))
    await settle()

    expect(itemOf(store)).toMatchObject({ status: "failed", error: { code: "UPLOAD_REJECTED" } })
    expect(fake.api.complete).toHaveBeenCalledOnce()
  })
})
