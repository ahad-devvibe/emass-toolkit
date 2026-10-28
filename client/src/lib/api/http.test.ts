import { describe, expect, it } from "vitest"
import { apiBase } from "./http"

describe("apiBase", () => {
  it("stays same-origin /api when no API host is set", () => {
    expect(apiBase(undefined)).toBe("/api")
    expect(apiBase("")).toBe("/api")
  })

  it("calls the API host directly, however the URL ends", () => {
    expect(apiBase("https://api.example.com")).toBe("https://api.example.com/api")
    expect(apiBase(" https://api.example.com// ")).toBe("https://api.example.com/api")
  })
})
