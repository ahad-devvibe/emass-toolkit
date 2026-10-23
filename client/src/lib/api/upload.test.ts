import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiRequestError } from "./http"
import { uploadMultipart } from "./upload"

// Just enough XMLHttpRequest to drive uploadMultipart from a test
class FakeXhr {
  static last: FakeXhr
  method = ""
  url = ""
  status = 0
  responseType = ""
  responseText = ""
  headers: Record<string, string> = {}
  body: FormData | null = null
  aborted = false
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null; onload: (() => void) | null } = { onprogress: null, onload: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null

  constructor() {
    FakeXhr.last = this
  }
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: FormData) {
    this.body = body
  }
  abort() {
    this.aborted = true
    this.onabort?.()
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = typeof body === "string" ? body : JSON.stringify(body)
    this.onload?.()
  }
}

const original = globalThis.XMLHttpRequest
beforeEach(() => {
  globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest
})
afterEach(() => {
  globalThis.XMLHttpRequest = original
})

const file = new File(["hello"], "emass.msi")

describe("uploadMultipart", () => {
  it("posts the fields before the file and unwraps the envelope", async () => {
    const result = uploadMultipart<{ file: { id: string } }>("/releases/r1/files", [["kind", "SDK"], ["platform", "WINDOWS"]], file)
    const xhr = FakeXhr.last

    expect(xhr.method).toBe("POST")
    expect(xhr.url).toBe("/api/releases/r1/files")
    expect([...xhr.body!.keys()]).toEqual(["kind", "platform", "file"])
    expect((xhr.body!.get("file") as File).name).toBe("emass.msi")

    xhr.respond(201, { success: true, statusCode: 201, message: "File uploaded", data: { file: { id: "f1" } } })
    await expect(result).resolves.toEqual({ file: { id: "f1" } })
  })

  it("reports progress, then the full size once the bytes are sent", async () => {
    const seen: [number, number][] = []
    const result = uploadMultipart("/x", [], file, { onProgress: (loaded, total) => seen.push([loaded, total]) })
    const xhr = FakeXhr.last

    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 5 })
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 3, total: 0 })
    xhr.upload.onload?.()
    xhr.respond(201, { success: true, statusCode: 201, message: "ok", data: null })
    await result

    expect(seen).toEqual([
      [2, 5],
      [5, 5],
    ])
  })

  it("turns error envelopes into ApiRequestError with details", async () => {
    const result = uploadMultipart("/x", [], file)
    FakeXhr.last.respond(409, { success: false, statusCode: 409, message: "taken", code: "PLATFORM_TAKEN", details: { fileId: "f9" } })

    const error = await result.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 409, code: "PLATFORM_TAKEN", details: { fileId: "f9" } })
  })

  it("keeps field errors separate from other details", async () => {
    const result = uploadMultipart("/x", [], file)
    FakeXhr.last.respond(400, { success: false, statusCode: 400, message: "bad", code: "VALIDATION_ERROR", details: { fieldErrors: { platform: ["Platform is required for an SDK"] }, formErrors: [] } })

    await expect(result).rejects.toMatchObject({ fieldErrors: { platform: ["Platform is required for an SDK"] }, details: { formErrors: [] } })
  })

  it("reports a non-JSON answer as SERVER_UNAVAILABLE and a dropped connection as NETWORK_ERROR", async () => {
    const proxy = uploadMultipart("/x", [], file)
    FakeXhr.last.respond(502, "<html>Bad gateway</html>")
    await expect(proxy).rejects.toMatchObject({ code: "SERVER_UNAVAILABLE" })

    const dropped = uploadMultipart("/x", [], file)
    FakeXhr.last.onerror?.()
    await expect(dropped).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" })
  })

  it("aborts the request when the signal fires", async () => {
    const controller = new AbortController()
    const result = uploadMultipart("/x", [], file, { signal: controller.signal })
    const xhr = FakeXhr.last

    controller.abort()

    expect(xhr.aborted).toBe(true)
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" })
  })

  it("never starts when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    FakeXhr.last = undefined as unknown as FakeXhr

    await expect(uploadMultipart("/x", [], file, { signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" })
    expect(FakeXhr.last).toBeUndefined()
  })
})
