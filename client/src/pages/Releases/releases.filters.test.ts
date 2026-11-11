import { describe, expect, it } from "vitest"
import { statusFilterOf, tabCount } from "./releases.filters"

const counts = { draft: 2, published: 1, archived: 4, rolled_back: 2 }

describe("tabCount", () => {
  it("counts one status per tab", () => {
    expect(tabCount("published", counts)).toBe(1)
    expect(tabCount("draft", counts)).toBe(2)
  })

  it("keeps rolled-back releases out of Archived", () => {
    expect(tabCount("archived", counts)).toBe(4)
    expect(tabCount("rolled_back", counts)).toBe(2)
  })

  it("sums everything for All", () => {
    expect(tabCount("all", counts)).toBe(9)
  })
})

describe("statusFilterOf", () => {
  it("falls back to All for unknown values", () => {
    expect(statusFilterOf("in_review").value).toBe("all")
    expect(statusFilterOf(null).value).toBe("all")
    expect(statusFilterOf("archived").statuses).toEqual(["archived"])
    expect(statusFilterOf("rolled_back").statuses).toEqual(["rolled_back"])
  })
})
