import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { EmailDomainKind, UserRole, UserStatus } from "@prisma/client";
import { prisma } from "../../src/configs/prisma.js";
import { env } from "../../src/configs/env.js";
import {
  generateAccessToken,
  hashPassword,
} from "../../src/services/auth/auth.utils.js";

export const TEST_PASSWORD = "password123";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

/**
 * Builds a captcha cookie that the real verifyCaptcha() accepts for `code`
 * (same HMAC/JWT scheme, same secret) — lets API tests skip OCR.
 */
export function captchaCookieFor(code: string): string {
  return jwt.sign(
    {
      kind: "captcha",
      h: createHash("sha256").update(code.toLowerCase()).digest("hex"),
    },
    env.JWT_SECRET,
    { expiresIn: 600 },
  );
}

export const TEST_CAPTCHA_CODE = "TEST123";

interface CreateUserOptions {
  role?: UserRole;
  status?: UserStatus;
  password?: string | null;
  firstName?: string;
  emailVerified?: boolean;
}

export async function createUser(
  email: string,
  options: CreateUserOptions = {},
): Promise<TestUser> {
  const password =
    options.password === undefined ? TEST_PASSWORD : options.password;
  const user = await prisma.user.create({
    data: {
      email,
      firstName: options.firstName ?? "Test",
      lastName: "User",
      country: "US",
      companyName: "Example Co",
      jobTitle: "Engineer",
      password: password === null ? null : await hashPassword(password),
      emailVerified: options.emailVerified ?? true,
      role: options.role ?? "CUSTOMER",
      status: options.status ?? "ACTIVE",
    },
  });
  return {
    id: user.id,
    email: user.email,
    password: password ?? "",
    accessToken: generateAccessToken(user.id, user.role),
    refreshToken: "",
  };
}

export async function promoteToAdmin(user: TestUser): Promise<TestUser> {
  await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  return { ...user, accessToken: generateAccessToken(user.id, "ADMIN") };
}

export async function promoteToDev(user: TestUser): Promise<TestUser> {
  await prisma.user.update({ where: { id: user.id }, data: { role: "DEV" } });
  return { ...user, accessToken: generateAccessToken(user.id, "DEV") };
}

export async function seedDomainPoliciesForTest(): Promise<void> {
  const rows: { domain: string; kind: EmailDomainKind }[] = [
    { domain: "blocked-competitor.example", kind: "COMPETITOR" },
    { domain: "gmail.com", kind: "FREE_MAIL" },
  ];
  for (const row of rows) {
    await prisma.emailDomainPolicy.upsert({
      where: { domain: row.domain },
      update: {},
      create: row,
    });
  }
}

export function uniqueEmail(prefix = "user"): string {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.com`;
}
