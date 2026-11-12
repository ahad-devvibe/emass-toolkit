import { describe, expect, it } from "vitest"
import type { ExternalProduct } from "./external-product.api"
import { cardProblems, formOf, isDirty } from "./external-product.utils"

const valid = { name: "Model Zoo", description: "", url: "https://example.com", label: "Open" }

describe("cardProblems", () => {
  it("accepts a name, an https link and a label; the description is optional", () => {
    expect(cardProblems(valid)).toEqual({})
  })

  it("asks for the required fields", () => {
    expect(cardProblems({ name: " ", description: "", url: "", label: "" })).toEqual({
      name: "Name is required",
      url: "URL is required",
      label: "Button label is required",
    })
  })

  it("refuses anything but https", () => {
    for (const url of ["http://example.com", "javascript:alert(1)", "example.com"]) {
      expect(cardProblems({ ...valid, url }).url).toBe("URL must be a full https:// link")
    }
  })

  it("enforces the lengths", () => {
    expect(cardProblems({ ...valid, name: "x".repeat(81), description: "x".repeat(201), label: "x".repeat(41) })).toEqual({
      name: "Name must be at most 80 characters",
      description: "Description must be at most 200 characters",
      label: "Button label must be at most 40 characters",
    })
  })
})

describe("isDirty", () => {
  const product: ExternalProduct = { id: "p1", name: "Model Zoo", description: null, isActive: true, link: { url: "https://example.com", label: "Open" }, updatedAt: "" }

  it("ignores surrounding spaces and a missing description", () => {
    expect(isDirty(product, formOf(product))).toBe(false)
    expect(isDirty(product, { ...formOf(product), name: " Model Zoo " })).toBe(false)
  })

  it("notices a real change", () => {
    expect(isDirty(product, { ...formOf(product), description: "New" })).toBe(true)
    expect(isDirty(product, { ...formOf(product), label: "Visit" })).toBe(true)
  })
})
