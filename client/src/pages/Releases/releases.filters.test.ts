import { describe, expect, it } from "vitest"
import { statusFilterOf, tabCount } from "./releases.filters"

const counts = { draft: 2, in_review: 3, changes_requested: 1, published: 1, archived: 4, rolled_back: 2 }

describe("tabCount", () => {
  it("counts one status per tab", () => {
    expect(tabCount("in_review", counts)).toBe(3)
    expect(tabCount("draft", counts)).toBe(2)
  })

  it("adds rolled-back releases to Archived", () => {
    expect(tabCount("archived", counts)).toBe(6)
  })

  it("sums everything for All", () => {
    expect(tabCount("all", counts)).toBe(13)
  })
})

describe("statusFilterOf", () => {
  it("falls back to All for unknown values", () => {
    expect(statusFilterOf("rolled_back").value).toBe("all")
    expect(statusFilterOf(null).value).toBe("all")
    expect(statusFilterOf("archived").statuses).toEqual(["archived", "rolled_back"])
  })
})
