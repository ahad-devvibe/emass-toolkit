import { describe, expect, it } from "vitest"
import { compactCount, moreCount } from "./dashboard.utils"

describe("moreCount", () => {
  it("counts what the list leaves out, never below zero", () => {
    expect(moreCount(5, 7)).toBe(2)
    expect(moreCount(3, 3)).toBe(0)
    expect(moreCount(5, 2)).toBe(0)
  })
})

describe("compactCount", () => {
  it("keeps numbers under a thousand exact", () => {
    expect(compactCount(0)).toBe("0")
    expect(compactCount(999)).toBe("999")
  })

  it("shortens to K, M and B with at most one decimal", () => {
    expect(compactCount(1_234)).toBe("1.2K")
    expect(compactCount(1_000_000)).toBe("1M")
    expect(compactCount(3_450_000)).toBe("3.5M")
    expect(compactCount(1_000_000_000)).toBe("1B")
  })
})
