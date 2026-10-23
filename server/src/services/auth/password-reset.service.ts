import { randomBytes } from "node:crypto";
import { UserStatus, type User } from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { emailService, type EmailSender } from "../email/email.service.js";
import {
  RESET_LINK_TTL_MS,
  RESET_REQUEST_COOLDOWN_MS,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyPassword,
} from "./auth.utils.js";
import { revokeAllUserTokens } from "./token.service.js";

// Forgot password by emailed link:
//   1. POST /auth/forgot-password       (email; same answer whether or not it exists)
//   2. POST /auth/reset-password/check  (token from the link; returns the email)
//   3. POST /auth/reset-password        (token + new password; link used up)
// Only the newest link works, it works once, and a reset signs out every session.

const RESET_LINK_TTL_MINUTES = RESET_LINK_TTL_MS / 60_000;

const linkInvalid = () =>
  new ApiError(
    400,
    "This reset link is invalid or has already been used",
    "RESET_LINK_INVALID",
  );

const linkExpired = () =>
  new ApiError(400, "This reset link has expired", "RESET_LINK_EXPIRED");

/** Accounts with a password that aren't blocked: ACTIVE and PENDING_APPROVAL. */
const canReset = (user: Pick<User, "status" | "password">) =>
  !!user.password && user.status !== UserStatus.BLOCKED;

export function buildResetPasswordUrl(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

/**
 * Step 1. Emails a reset link when the account can reset its password, and
 * resolves the same way when it can't (or doesn't exist), so the endpoint
 * never reveals which emails have accounts. A failed send is logged, not
 * reported, for the same reason.
 */
export async function requestPasswordReset(
  emailInput: string,
  sender: EmailSender = emailService,
): Promise<void> {
  await sender.assertReady();
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(emailInput) },
  });
  if (!user || !canReset(user)) {
    logger.debug("password reset requested for an ineligible email");
    return;
  }

  const recent = await prisma.passwordResetToken.findFirst({
    where: {
      userId: user.id,
      createdAt: { gt: new Date(Date.now() - RESET_REQUEST_COOLDOWN_MS) },
    },
    select: { id: true },
  });
  if (recent) return;

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_LINK_TTL_MS),
      },
    }),
  ]);

  try {
    await sender.sendPasswordResetEmail(
      user.email,
      user.firstName,
      buildResetPasswordUrl(token),
      RESET_LINK_TTL_MINUTES,
    );
  } catch (err) {
    logger.error({ err, userId: user.id }, "password reset email failed");
  }
}

async function findUsableToken(token: string) {
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!row || row.consumedAt || !canReset(row.user)) throw linkInvalid();
  if (row.expiresAt.getTime() <= Date.now()) throw linkExpired();
  return row;
}

/** Step 2: is the link still good? Returns the account's email for the page. */
export async function checkPasswordResetToken(
  token: string,
): Promise<{ email: string }> {
  const row = await findUsableToken(token);
  return { email: row.user.email };
}

/**
 * Step 3: set the new password and use the link up, then sign the account
 * out everywhere. Reusing the current password is refused without using the
 * link up, so the person can try again.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<void> {
  const row = await findUsableToken(token);
  if (await verifyPassword(newPassword, row.user.password!)) {
    throw new ApiError(
      400,
      "New password must be different from your current password",
      "PASSWORD_REUSE",
    );
  }
  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    // Guards a double submit and a link that expired since the check above
    const used = await tx.passwordResetToken.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (used.count === 0) throw linkInvalid();
    await tx.user.update({
      where: { id: row.userId },
      data: { password: passwordHash },
    });
    await tx.passwordResetToken.deleteMany({
      where: { userId: row.userId, id: { not: row.id } },
    });
  });

  await revokeAllUserTokens(row.userId);
}
