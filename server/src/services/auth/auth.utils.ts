import bcrypt from "bcrypt";
import { createHash, randomBytes, randomInt } from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { env } from "../../configs/env.js";
import { ApiError } from "../../utils/api-error.utils.js";

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_CODE_LENGTH = 6;

const BCRYPT_ROUNDS = 12;
const BCRYPT_OTP_ROUNDS = 12;

function getJwtSecret(): string {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new ApiError(
      500,
      "JWT_SECRET is not configured",
      "JWT_SECRET_MISSING",
    );
  }
  return secret;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export const DUMMY_PASSWORD_HASH =
  "$2b$12$r.u6nPX7CWyHt8EDsSuPn.t6EneYVYCgffVb7Ol9NsuOpmS76ZZWe";

export interface AccessTokenPayload {
  userId: string;
  role: UserRole;
}

export function generateAccessToken(userId: string, role: UserRole): string {
  return jwt.sign({ sub: userId, role }, getJwtSecret(), {
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const payload = jwt.verify(token, getJwtSecret());
    if (typeof payload === "string" || typeof payload.sub !== "string") {
      throw new Error("malformed payload");
    }
    const role =
      payload.role === "ADMIN" || payload.role === "DEV"
        ? payload.role
        : "CUSTOMER";
    return { userId: payload.sub, role };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new ApiError(401, "Access token expired", "TOKEN_EXPIRED");
    }
    throw new ApiError(401, "Invalid access token", "TOKEN_INVALID");
  }
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, "0");
}

export async function hashOtpCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_OTP_ROUNDS);
}

export async function verifyOtpCode(
  code: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
