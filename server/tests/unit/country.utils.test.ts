import { describe, expect, it } from "vitest";
import {
  ISO_COUNTRY_CODES,
  countryName,
  isCountryCode,
} from "../../src/utils/country.utils.js";

describe("country.utils", () => {
  it("knows the assigned alpha-2 codes", () => {
    expect(ISO_COUNTRY_CODES.size).toBe(249);
  });

  it("accepts assigned codes case-insensitively", () => {
    expect(isCountryCode("SG")).toBe(true);
    expect(isCountryCode("sg")).toBe(true);
  });

  it("rejects unassigned or malformed codes", () => {
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("USA")).toBe(false);
    expect(isCountryCode("")).toBe(false);
  });

  it("maps codes to English names", () => {
    expect(countryName("SG")).toBe("Singapore");
    expect(countryName("gb")).toBe("United Kingdom");
  });

  it("falls back to the code for unknown input", () => {
    expect(countryName("ZZ")).toBe("ZZ");
  });
});
