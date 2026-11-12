import { describe, expect, it } from "vitest"
import { currentCursor, downloadsParam, formatCount, formatExact, fullName, nextPage, pageRange, previousPage, statusParam } from "./customers.utils"

describe("page stack", () => {
  it("starts with no cursor, then follows Next and Previous", () => {
    let stack: string[] = []
    expect(currentCursor(stack)).toBeUndefined()
    stack = nextPage(stack, "c1")
    stack = nextPage(stack, "c2")
    expect(currentCursor(stack)).toBe("c2")
    stack = previousPage(stack)
    expect(currentCursor(stack)).toBe("c1")
    stack = previousPage(stack)
    expect(currentCursor(stack)).toBeUndefined()
    expect(previousPage(stack)).toEqual([])
  })

  it("labels the rows on the page", () => {
    expect(pageRange([], 25, 25, 312)).toBe("1–25 of 312")
    expect(pageRange(["a", "b"], 25, 12, 62)).toBe("51–62 of 62")
    expect(pageRange([], 25, 0, 0)).toBe("0 of 0")
  })
})

describe("download counts", () => {
  it("abbreviates with K, M and B", () => {
    expect(formatCount(0)).toBe("0")
    expect(formatCount(999)).toBe("999")
    expect(formatCount(1_000)).toBe("1K")
    expect(formatCount(1_250)).toBe("1.3K")
    expect(formatCount(999_950)).toBe("1M")
    expect(formatCount(1_234_567)).toBe("1.2M")
    expect(formatCount(1_000_000_000)).toBe("1B")
  })

  it("spells the exact count out", () => {
    expect(formatExact(999)).toBe("999")
    expect(formatExact(1_234_567)).toBe("1,234,567")
  })
})

describe("URL params", () => {
  it("keeps known values and drops the rest", () => {
    expect(statusParam("BLOCKED")).toBe("BLOCKED")
    expect(statusParam("nope")).toBeUndefined()
    expect(statusParam(null)).toBeUndefined()
    expect(downloadsParam("none")).toBe("none")
    expect(downloadsParam("some")).toBeUndefined()
  })
})

it("joins name parts, skipping a missing middle name", () => {
  expect(fullName({ firstName: "Ada", middleName: null, lastName: "Lovelace" })).toBe("Ada Lovelace")
  expect(fullName({ firstName: "Ada", middleName: "B", lastName: "Lovelace" })).toBe("Ada B Lovelace")
})
