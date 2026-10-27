import { describe, expect, it } from "vitest"
import type { DomainPolicy } from "./domains.api"
import { countByKind, filterDomains, normalizeDomainInput, otherTabMatches } from "./domains.utils"

const row = (domain: string, kind: DomainPolicy["kind"]): DomainPolicy => ({ id: domain, domain, kind, createdAt: "2026-10-24T00:00:00.000Z" })
const rows = [row("gmail.com", "FREE_MAIL"), row("yahoo.com", "FREE_MAIL"), row("rival.example", "COMPETITOR")]

describe("normalizeDomainInput", () => {
  it("accepts domains, @domains and pasted addresses", () => {
    expect(normalizeDomainInput("  Gmail.COM ")).toBe("gmail.com")
    expect(normalizeDomainInput("@gmail.com")).toBe("gmail.com")
    expect(normalizeDomainInput("jo@Mail.Example.co.uk")).toBe("mail.example.co.uk")
  })

  it("rejects what isn't a domain", () => {
    for (const raw of ["", "localhost", "not a domain", "-bad.example", "a@"]) expect(normalizeDomainInput(raw)).toBeNull()
  })
})

describe("countByKind / filterDomains / otherTabMatches", () => {
  it("counts each list", () => {
    expect(countByKind(rows)).toEqual({ FREE_MAIL: 2, COMPETITOR: 1 })
  })

  it("filters by tab and search", () => {
    expect(filterDomains(rows, "FREE_MAIL", "").map((r) => r.domain)).toEqual(["gmail.com", "yahoo.com"])
    expect(filterDomains(rows, "FREE_MAIL", " YAH ").map((r) => r.domain)).toEqual(["yahoo.com"])
    expect(filterDomains(rows, "COMPETITOR", "gmail")).toEqual([])
  })

  it("counts matches in the other tab, only while searching", () => {
    expect(otherTabMatches(rows, "COMPETITOR", "gmail")).toBe(1)
    expect(otherTabMatches(rows, "FREE_MAIL", "gmail")).toBe(0)
    expect(otherTabMatches(rows, "COMPETITOR", "  ")).toBe(0)
  })
})
