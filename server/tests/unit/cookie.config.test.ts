import { describe, expect, it } from "vitest";
import { cookieOptions } from "../../src/configs/cookie.config.js";

describe("cookieOptions", () => {
  it("keeps Strict cookies, Secure only in production", () => {
    expect(cookieOptions("strict", false).access).toMatchObject({
      sameSite: "strict",
      secure: false,
      httpOnly: true,
    });
    expect(cookieOptions("strict", true).refresh.secure).toBe(true);
  });

  it("always makes cross-site (None) cookies Secure, or browsers drop them", () => {
    const options = cookieOptions("none", false);

    for (const cookie of [options.access, options.refresh, options.captcha]) {
      expect(cookie).toMatchObject({ sameSite: "none", secure: true });
    }
  });

  it("clears with the same attributes, minus the lifetime", () => {
    const options = cookieOptions("none", true);

    expect(options.clearAccess).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/api",
    });
    expect(options.clearRefresh.path).toBe("/api/auth");
    expect(options.clearLegacyRefresh.path).toBe("/api/auth/refresh");
    expect(options.clearCaptcha).not.toHaveProperty("maxAge");
  });
});
