import { createHash, randomBytes } from "node:crypto";
import { UserStatus } from "@prisma/client";
import { env } from "../../configs/env.js";
import { prisma } from "../../configs/prisma.js";
import { logger } from "../../configs/logger.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { hashPassword, normalizeEmail } from "./auth.utils.js";
import { emailService, type EmailSender } from "../email/email.service.js";

export function buildSetPasswordUrl(token: string): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}/set-password?token=${encodeURIComponent(token)}`;
}

function hashSetPasswordToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function buildCatalogUrl(): string {
  return `${env.APP_BASE_URL.replace(/\/+$/, "")}/catalog`;
}

export function setPasswordTtlMs(): number {
  return env.SET_PASSWORD_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Issues a fresh set-password token for the user (deletes any previous ones)
 * and emails the link. Returns nothing; the raw token only ever leaves here
 * inside the email.
 */
export async function issueSetPasswordToken(
  userId: string,
  sender: EmailSender = emailService,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await sender.assertReady();

  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction([
    prisma.setPasswordToken.deleteMany({ where: { userId } }),
    prisma.setPasswordToken.create({
      data: {
        userId,
        tokenHash: hashSetPasswordToken(token),
        expiresAt: new Date(Date.now() + setPasswordTtlMs()),
      },
    }),
  ]);

  await sender.sendSetPasswordEmail(
    user.email,
    user.firstName,
    buildSetPasswordUrl(token),
    env.SET_PASSWORD_TTL_HOURS,
  );
}

export async function getSetPasswordInvite(token: string): Promise<{
  email: string;
  firstName: string;
  expiresAt: Date;
}> {
  const row = await prisma.setPasswordToken.findUnique({
    where: { tokenHash: hashSetPasswordToken(token) },
    include: {
      user: { select: { email: true, firstName: true, status: true } },
    },
  });
  if (!row || row.consumedAt) {
    throw new ApiError(
      404,
      "Invalid set-password link",
      "SET_PASSWORD_TOKEN_INVALID",
    );
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new ApiError(
      400,
      "Set-password link has expired",
      "SET_PASSWORD_EXPIRED",
    );
  }
  if (row.user.status !== UserStatus.PENDING_SET_PASSWORD) {
    throw new ApiError(
      404,
      "Invalid set-password link",
      "SET_PASSWORD_TOKEN_INVALID",
    );
  }
  return {
    email: row.user.email,
    firstName: row.user.firstName,
    expiresAt: row.expiresAt,
  };
}

export async function redeemSetPasswordToken(
  token: string,
  newPassword: string,
  sender: EmailSender = emailService,
): Promise<void> {
  const row = await prisma.setPasswordToken.findUnique({
    where: { tokenHash: hashSetPasswordToken(token) },
    include: {
      user: {
        select: { id: true, status: true, email: true, firstName: true },
      },
    },
  });
  if (
    !row ||
    row.consumedAt ||
    row.user.status !== UserStatus.PENDING_SET_PASSWORD
  ) {
    throw new ApiError(
      404,
      "Invalid set-password link",
      "SET_PASSWORD_TOKEN_INVALID",
    );
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new ApiError(
      400,
      "Set-password link has expired",
      "SET_PASSWORD_EXPIRED",
    );
  }

  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.setPasswordToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.setPasswordToken.deleteMany({
      where: { userId: row.userId, consumedAt: null, NOT: { id: row.id } },
    }),
    prisma.user.update({
      where: { id: row.userId },
      data: {
        password: passwordHash,
        emailVerified: true,
        status: UserStatus.ACTIVE,
      },
    }),
  ]);

  // Best-effort: the account is already active, so a failed welcome email
  // must not fail the request.
  try {
    await sender.sendWelcomeEmail(
      row.user.email,
      row.user.firstName,
      buildCatalogUrl(),
    );
  } catch (err) {
    logger.warn({ err, userId: row.userId }, "welcome email not sent");
  }
}

export async function resendSetPasswordEmail(
  emailInput: string,
  sender: EmailSender = emailService,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(emailInput) },
  });
  if (!user || user.status !== UserStatus.PENDING_SET_PASSWORD) {
    throw new ApiError(404, "User not found", "USER_NOT_FOUND");
  }
  await issueSetPasswordToken(user.id, sender);
}

/**
 * Cron sweep: exactly one reminder per token, sent once the token is
 * SET_PASSWORD_REMINDER_HOURS old and still unconsumed/unexpired.
 *
 * Tokens are stored hashed, so the original raw link is unrecoverable. The
 * reminder re-issues a token that KEEPS the original `expiresAt` (no expiry
 * extension) and invalidates the old one — the user gets a working link that
 * dies at the original 48h deadline.
 */
export async function sendDueSetPasswordReminders(
  sender: EmailSender = emailService,
): Promise<number> {
  const reminderAgeMs = env.SET_PASSWORD_REMINDER_HOURS * 60 * 60 * 1000;
  const dueBefore = new Date(Date.now() - reminderAgeMs);

  const tokens = await prisma.setPasswordToken.findMany({
    where: {
      consumedAt: null,
      reminderSentAt: null,
      createdAt: { lte: dueBefore },
      expiresAt: { gt: new Date() },
    },
    include: { user: { select: { id: true, email: true, firstName: true } } },
  });

  let sent = 0;
  for (const row of tokens) {
    const rawToken = randomBytes(32).toString("base64url");
    const now = new Date();
    try {
      await prisma.$transaction([
        prisma.setPasswordToken.delete({ where: { id: row.id } }),
        prisma.setPasswordToken.create({
          data: {
            userId: row.userId,
            tokenHash: hashSetPasswordToken(rawToken),
            expiresAt: row.expiresAt,
            reminderSentAt: now,
          },
        }),
      ]);
    } catch (err) {
      // row already consumed/deleted between the sweep read and write — skip
      logger.debug(
        { err, userId: row.user.id },
        "set-password reminder skipped",
      );
      continue;
    }

    try {
      await sender.assertReady();
      const hoursLeft = Math.max(
        1,
        Math.round(
          (row.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000),
        ),
      );
      await sender.sendSetPasswordReminderEmail(
        row.user.email,
        row.user.firstName,
        buildSetPasswordUrl(rawToken),
        hoursLeft,
      );
      sent += 1;
    } catch (err) {
      logger.error(
        { err, userId: row.user.id },
        "set-password reminder email failed",
      );
      // allow the next sweep to retry
      await prisma.setPasswordToken
        .updateMany({
          where: { userId: row.userId, reminderSentAt: now },
          data: { reminderSentAt: null },
        })
        .catch(() => undefined);
    }
  }
  return sent;
}
