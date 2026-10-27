import { describe, expect, it } from "vitest"
import { breakdown, moreCount } from "./dashboard.utils"

describe("breakdown", () => {
  it("joins the non-zero parts", () => {
    expect(breakdown([[3, "customers"], [2, "staff"]])).toBe("3 customers · 2 staff")
    expect(breakdown([[0, "competitor"], [1, "rejected"]])).toBe("1 rejected")
  })

  it("falls back when everything is zero", () => {
    expect(breakdown([[0, "competitor"], [0, "rejected"]], "None")).toBe("None")
  })
})

describe("moreCount", () => {
  it("counts what the list leaves out, never below zero", () => {
    expect(moreCount(5, 7)).toBe(2)
    expect(moreCount(3, 3)).toBe(0)
    expect(moreCount(5, 2)).toBe(0)
  })
})
