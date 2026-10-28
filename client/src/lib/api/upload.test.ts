import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { ApiRequestError } from "./http"
import { sendBlob } from "./upload"

// Just enough XMLHttpRequest to drive sendBlob from a test
class FakeXhr {
  static last: FakeXhr
  method = ""
  url = ""
  status = 0
  responseType = ""
  responseText = ""
  headers: Record<string, string> = {}
  body: Blob | null = null
  withCredentials = false
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
  send(body: Blob) {
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

describe("sendBlob", () => {
  it("sends the raw bytes with cookies and unwraps the envelope", async () => {
    const part = file.slice(0, 3)
    const result = sendBlob<{ partsDone: number }>("PUT", "/releases/r1/uploads/u1/parts/1", part)
    const xhr = FakeXhr.last

    expect(xhr.method).toBe("PUT")
    expect(xhr.url).toBe("/api/releases/r1/uploads/u1/parts/1")
    expect(xhr.headers["Content-Type"]).toBe("application/octet-stream")
    expect(xhr.withCredentials).toBe(true)
    expect(xhr.body).toBe(part)

    xhr.respond(200, { success: true, statusCode: 200, message: "Part stored", data: { partsDone: 1 } })
    await expect(result).resolves.toEqual({ partsDone: 1 })
  })

  it("reports progress, then the full size once the bytes are sent", async () => {
    const seen: [number, number][] = []
    const result = sendBlob("PUT", "/x", file, { onProgress: (loaded, total) => seen.push([loaded, total]) })
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
    const result = sendBlob("PUT", "/x", file)
    FakeXhr.last.respond(409, { success: false, statusCode: 409, message: "taken", code: "PLATFORM_TAKEN", details: { fileId: "f9" } })

    const error = await result.catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 409, code: "PLATFORM_TAKEN", details: { fileId: "f9" } })
  })

  it("keeps field errors separate from other details", async () => {
    const result = sendBlob("PUT", "/x", file)
    FakeXhr.last.respond(400, { success: false, statusCode: 400, message: "bad", code: "VALIDATION_ERROR", details: { fieldErrors: { platform: ["Platform is required for an SDK"] }, formErrors: [] } })

    await expect(result).rejects.toMatchObject({ fieldErrors: { platform: ["Platform is required for an SDK"] }, details: { formErrors: [] } })
  })

  it("reports a non-JSON answer as SERVER_UNAVAILABLE and a dropped connection as NETWORK_ERROR", async () => {
    const proxy = sendBlob("PUT", "/x", file)
    FakeXhr.last.respond(502, "<html>Bad gateway</html>")
    await expect(proxy).rejects.toMatchObject({ code: "SERVER_UNAVAILABLE" })

    const dropped = sendBlob("PUT", "/x", file)
    FakeXhr.last.onerror?.()
    await expect(dropped).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" })
  })

  it("aborts the request when the signal fires", async () => {
    const controller = new AbortController()
    const result = sendBlob("PUT", "/x", file, { signal: controller.signal })
    const xhr = FakeXhr.last

    controller.abort()

    expect(xhr.aborted).toBe(true)
    await expect(result).rejects.toMatchObject({ code: "CANCELLED" })
  })

  it("never starts when the signal is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()
    FakeXhr.last = undefined as unknown as FakeXhr

    await expect(sendBlob("PUT", "/x", file, { signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" })
    expect(FakeXhr.last).toBeUndefined()
  })
})
