import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  OTP_CODE_LENGTH,
  generateAccessToken,
  generateOtpCode,
  generateRefreshToken,
  hashOtpCode,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyAccessToken,
  verifyOtpCode,
  verifyPassword,
} from "../../src/services/auth/auth.utils.js";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
  });
});

describe("generateOtpCode", () => {
  it("returns a 6-digit numeric code", () => {
    expect(OTP_CODE_LENGTH).toBe(6);
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("generates distinct codes", () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("hashOtpCode + verifyOtpCode", () => {
  it("hashes so the correct code verifies", async () => {
    const hash = await hashOtpCode("123456");
    await expect(verifyOtpCode("123456", hash)).resolves.toBe(true);
  });

  it("rejects a wrong code", async () => {
    const hash = await hashOtpCode("123456");
    await expect(verifyOtpCode("654321", hash)).resolves.toBe(false);
  });

  it("produces non-deterministic hashes (bcrypt salt)", async () => {
    const a = await hashOtpCode("123456");
    const b = await hashOtpCode("123456");
    expect(a).not.toBe(b);
  });
});

describe("hashToken", () => {
  it("is deterministic and 64 hex chars", () => {
    const token = "some-refresh-token";
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("differs per token", () => {
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });
});

describe("generateRefreshToken", () => {
  it("is unique and base64url", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("password hashing", () => {
  it("hashes and verifies a correct password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse battery");
    await expect(verifyPassword("correct horse battery", hash)).resolves.toBe(
      true,
    );
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("right");
    await expect(verifyPassword("wrong", hash)).resolves.toBe(false);
  });
});

describe("access token", () => {
  it("round-trips userId and role", () => {
    const token = generateAccessToken("user-123", "CUSTOMER");
    expect(verifyAccessToken(token)).toEqual({
      userId: "user-123",
      role: "CUSTOMER",
    });
  });

  it("round-trips DEV and ADMIN roles", () => {
    expect(verifyAccessToken(generateAccessToken("u", "DEV")).role).toBe("DEV");
    expect(verifyAccessToken(generateAccessToken("u", "ADMIN")).role).toBe(
      "ADMIN",
    );
  });

  it("normalizes an unknown role claim to CUSTOMER", () => {
    const token = jwt.sign(
      { sub: "user-123", role: "SELF" },
      process.env.JWT_SECRET!,
      {
        expiresIn: 600,
      },
    );
    expect(verifyAccessToken(token)).toEqual({
      userId: "user-123",
      role: "CUSTOMER",
    });
  });

  it("rejects an expired token with TOKEN_EXPIRED", () => {
    const expired = jwt.sign({ sub: "user-123" }, process.env.JWT_SECRET!, {
      expiresIn: -10,
    });

    expect(() => verifyAccessToken(expired)).toThrowError(
      expect.objectContaining({ code: "TOKEN_EXPIRED" }),
    );
  });

  it("rejects a tampered token with TOKEN_INVALID", () => {
    const token = generateAccessToken("user-123", "CUSTOMER");
    const parts = token.split(".");
    parts[2] = "tampered-signature";

    expect(() => verifyAccessToken(parts.join("."))).toThrowError(
      expect.objectContaining({ code: "TOKEN_INVALID" }),
    );
  });

  it("rejects garbage with TOKEN_INVALID", () => {
    expect(() => verifyAccessToken("not-a-token")).toThrowError(
      expect.objectContaining({ code: "TOKEN_INVALID" }),
    );
  });
});
