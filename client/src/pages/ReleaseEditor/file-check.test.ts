import { describe, expect, it, vi } from "vitest"
import { ApiRequestError } from "@/lib/api/http"
import type { FileCheckInput, FileCheckResult } from "@/pages/Releases/releases.api"
import { checkFile, MAX_CHECK_ROUNDS, toBase64, type CheckRequest } from "./file-check"

const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 7) % 256)
const file = new File([bytes], "setup.exe")
const allowed: FileCheckResult = { status: "ALLOWED", format: "PE", versions: [{ version: "2.5.0" }], warnings: [] }

/** atob back to bytes: the browser's own decoder checks the encoding. */
const decode = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

describe("toBase64", () => {
  it("round-trips through atob, even past the chunk size", () => {
    expect(toBase64(Uint8Array.of(0, 1, 2, 250, 255))).toBe("AAEC+v8=")
    expect(decode(toBase64(bytes))).toEqual(bytes)
    expect(toBase64(new Uint8Array(0))).toBe("")
  })
})

describe("checkFile", () => {
  it("sends the ranges the server asks for until it rules, and keeps them for the next check", async () => {
    const inputs: FileCheckInput[] = []
    const api = vi.fn(async (input: FileCheckInput): Promise<FileCheckResult> => {
      inputs.push(structuredClone(input))
      if (input.ranges.length === 0) return { status: "NEED_BYTES", ranges: [{ offset: 0, length: 65536 }] }
      if (input.ranges.length === 1) return { status: "NEED_BYTES", ranges: [{ offset: 131072, length: bytes.length - 131072 }] }
      return allowed
    })
    const request: CheckRequest = { ranges: [], replace: "f1" }

    expect(await checkFile(api, file, request)).toEqual(allowed)

    expect(inputs.map((input) => input.ranges.map((range) => range.offset))).toEqual([[], [0], [0, 131072]])
    expect(inputs[0]).toEqual({ name: "setup.exe", size: bytes.length, ranges: [], replace: "f1" })
    expect(decode(request.ranges[1].data)).toEqual(bytes.subarray(131072))

    // The final check resends what it has, with the hash, without asking again
    await checkFile(api, file, { ...request, sha256: "h" })
    expect(inputs.at(-1)).toMatchObject({ sha256: "h", ranges: request.ranges })
    expect(api).toHaveBeenCalledTimes(4)
  })

  it("passes a FILE_BLOCKED error straight through", async () => {
    const blocked = new ApiRequestError(409, "FILE_BLOCKED", "blocked", {}, { reasons: [] })
    await expect(checkFile(async () => { throw blocked }, file, { ranges: [] })).rejects.toBe(blocked)
  })

  it("gives up when the server keeps asking for more", async () => {
    const api = vi.fn(async (): Promise<FileCheckResult> => ({ status: "NEED_BYTES", ranges: [{ offset: 0, length: 1 }] }))
    await expect(checkFile(api, file, { ranges: [] })).rejects.toMatchObject({ code: "CHECK_RUNAWAY" })
    expect(api).toHaveBeenCalledTimes(MAX_CHECK_ROUNDS)
  })
})
