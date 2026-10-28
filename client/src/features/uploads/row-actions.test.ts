import { describe, expect, it } from "vitest"
import type { FileHandle } from "./file-source"
import { needsCancelConfirm, rowActions } from "./row-actions"
import type { QueueStatus } from "./uploads.state"

const file = new File(["x"], "a.msi")
const handle = { kind: "file", name: "a.msi", getFile: async () => file } as FileHandle
const row = (status: QueueStatus, extra: { handle?: FileHandle | null; file?: File | null; blockedBy?: { code: string; message: string }[] } = {}) => ({ status, handle: null, file, blockedBy: [], ...extra })

describe("rowActions", () => {
  it("pauses or cancels anything still moving, and lets finalizing finish", () => {
    for (const status of ["queued", "checking", "hashing", "uploading", "waiting"] as const) {
      expect(rowActions(row(status)), status).toEqual(["pause", "cancel"])
    }
    expect(rowActions(row("finalizing"))).toEqual([])
  })

  it("resumes a paused upload", () => {
    expect(rowActions(row("paused"))).toEqual(["resume", "cancel"])
  })

  it("after a refresh, reopens from the handle where there is one, otherwise picks the file", () => {
    expect(rowActions(row("needsFile", { handle, file: null }))).toEqual(["resumeWithHandle", "cancel"])
    expect(rowActions(row("needsFile", { file: null }))).toEqual(["pickFile", "cancel"])
  })

  it("retries failures, and cancelled uploads only while their file is at hand", () => {
    expect(rowActions(row("failed"))).toEqual(["retry", "dismiss"])
    expect(rowActions(row("cancelled"))).toEqual(["retry", "dismiss"])
    expect(rowActions(row("cancelled", { file: null }))).toEqual(["dismiss"])
  })

  it("sends a held file to its editor from the panel only", () => {
    expect(rowActions(row("conflict"))).toEqual(["dismiss"])
    expect(rowActions(row("conflict"), { compact: true })).toEqual(["resolveInEditor", "dismiss"])
  })

  it("only dismisses finished rows and files blocked for good", () => {
    expect(rowActions(row("done"))).toEqual(["dismiss"])
    expect(rowActions(row("blocked", { blockedBy: [{ code: "SAME_CONTENT", message: "" }] }))).toEqual(["dismiss"])
    expect(rowActions(row("blocked", { blockedBy: [{ code: "VERSION_MISMATCH", message: "" }, { code: "DAMAGED", message: "" }] }))).toEqual(["dismiss"])
  })

  it("offers another check for a file blocked only for its version", () => {
    expect(rowActions(row("blocked", { blockedBy: [{ code: "VERSION_MISMATCH", message: "" }] }))).toEqual(["checkAgain", "dismiss"])
    expect(rowActions(row("blocked", { blockedBy: [{ code: "VERSION_EXISTS", message: "" }], file: null }))).toEqual(["dismiss"])
  })
})

describe("needsCancelConfirm", () => {
  const item = (status: QueueStatus, loaded = 0, uploadId: string | null = null) => ({ status, loaded, uploadId })

  it("asks once something was sent or a session is open", () => {
    for (const status of ["uploading", "waiting", "paused", "needsFile", "finalizing"] as const) {
      expect(needsCancelConfirm(item(status)), status).toBe(true)
    }
    expect(needsCancelConfirm(item("queued", 0, "u1"))).toBe(true)
  })

  it("cancels at once while nothing has been sent", () => {
    for (const status of ["queued", "checking", "hashing", "conflict"] as const) {
      expect(needsCancelConfirm(item(status)), status).toBe(false)
    }
  })
})
