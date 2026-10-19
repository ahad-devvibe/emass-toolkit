import { describe, expect, it } from "vitest";
import {
  classifyEmailDomain,
  extractEmailDomain,
} from "../../src/services/auth/domains.utils.js";

const competitors = new Set(["rival.example", "rival-tools.example"]);
const freeMail = new Set(["gmail.com", "yahoo.com"]);

describe("extractEmailDomain", () => {
  it("lowercases and trims", () => {
    expect(extractEmailDomain("  User@Gmail.COM ")).toBe("gmail.com");
  });

  it("handles missing domains", () => {
    expect(extractEmailDomain("nodomain")).toBe("");
  });
});

describe("classifyEmailDomain", () => {
  it("flags competitor domains first", () => {
    expect(classifyEmailDomain("a@rival.example", competitors, freeMail)).toBe(
      "COMPETITOR",
    );
    expect(classifyEmailDomain("a@RIVAL.example", competitors, freeMail)).toBe(
      "COMPETITOR",
    );
  });

  it("flags free-mail domains", () => {
    expect(classifyEmailDomain("a@gmail.com", competitors, freeMail)).toBe(
      "FREE_MAIL",
    );
  });

  it("treats everything else as custom", () => {
    expect(classifyEmailDomain("a@corp.com", competitors, freeMail)).toBe(
      "CUSTOM",
    );
    expect(classifyEmailDomain("a@mycorp.io", competitors, freeMail)).toBe(
      "CUSTOM",
    );
  });

  it("competitor wins over free-mail when a domain is in both", () => {
    expect(
      classifyEmailDomain(
        "a@rival.example",
        competitors,
        new Set(["rival.example"]),
      ),
    ).toBe("COMPETITOR");
  });
});
