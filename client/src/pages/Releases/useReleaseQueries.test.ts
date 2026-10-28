import { describe, expect, it } from "vitest"
import { initialLoaded } from "./useReleaseQueries"

describe("initialLoaded", () => {
  it("shows data already in hand as loaded under its key", () => {
    expect(initialLoaded("r1", { id: "r1" })).toEqual({ key: "r1", nonce: 0, data: { id: "r1" }, error: null })
  })

  it("starts empty without data or a key", () => {
    expect(initialLoaded("r1", undefined)).toBeNull()
    expect(initialLoaded(null, { id: "r1" })).toBeNull()
  })
})
