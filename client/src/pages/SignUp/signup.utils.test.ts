import { describe, expect, it } from "vitest"
import { displayWebsite, normalizeWebsite } from "./signup.utils"

describe("normalizeWebsite", () => {
  it("adds https:// and drops a bare domain's trailing slash", () => {
    expect(normalizeWebsite("acme.com")).toBe("https://acme.com")
    expect(normalizeWebsite("  www.acme.com/  ")).toBe("https://www.acme.com")
    expect(normalizeWebsite("HTTP://Acme.com")).toBe("http://acme.com")
  })

  it("keeps a path, query and port", () => {
    expect(normalizeWebsite("http://acme.com/en?x=1")).toBe("http://acme.com/en?x=1")
    expect(normalizeWebsite("acme.com:8080/docs")).toBe("https://acme.com:8080/docs")
  })

  it("refuses anything that isn't a public web address", () => {
    for (const value of ["", "not a site", "localhost", "ftp://acme.com", "javascript:alert(1)", "https://user:pass@acme.com", ".com", `acme.com/${"x".repeat(260)}`]) {
      expect(normalizeWebsite(value), value).toBeNull()
    }
  })
})

describe("displayWebsite", () => {
  it("shows the address without its scheme, www or trailing slash", () => {
    expect(displayWebsite("https://www.acme.com")).toBe("acme.com")
    expect(displayWebsite("http://acme.com/en/")).toBe("acme.com/en")
  })
})
