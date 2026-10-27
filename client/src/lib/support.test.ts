import { describe, expect, it } from "vitest"
import { supportMailto } from "./support"

describe("supportMailto", () => {
  it("builds a mailto link with an encoded subject", () => {
    expect(supportMailto("EMASS Core SDK v1.4.0", "help@example.com")).toBe("mailto:help@example.com?subject=EMASS%20Core%20SDK%20v1.4.0")
    expect(supportMailto(undefined, "help@example.com")).toBe("mailto:help@example.com")
  })

  it("is null without an address", () => {
    expect(supportMailto("Anything", null)).toBeNull()
  })
})
