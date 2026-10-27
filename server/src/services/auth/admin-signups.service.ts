import { BlockReason, UserStatus } from "@prisma/client";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { presentUser } from "./auth.errors.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.utils.js";
import { afterCursor, searchWhere } from "./admin-signups.utils.js";
import { onAccountActivated } from "./signup.service.js";
import { emailService, type EmailSender } from "../email/email.service.js";
import {
  hubspotService,
  type HubspotClient,
} from "../hubspot/hubspot.service.js";

export interface ListPendingSignupsInput {
  limit: number;
  cursor?: string;
  q?: string;
}

/** Oldest first, keyset-paginated on (createdAt, id); `total` ignores the cursor. */
export async function listPendingSignups({
  limit,
  cursor,
  q,
}: ListPendingSignupsInput) {
  const filter = {
    status: UserStatus.PENDING_APPROVAL,
    ...searchWhere(q),
  };
  const page = cursor
    ? { AND: [filter, afterCursor(decodeCursor(cursor))] }
    : filter;

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where: page,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit + 1,
    }),
    prisma.user.count({ where: filter }),
  ]);

  const hasMore = rows.length > limit;
  const signups = hasMore ? rows.slice(0, limit) : rows;
  const last = signups.at(-1);
  return {
    signups: signups.map(presentUser),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    total,
  };
}

export async function approveSignup(
  userId: string,
  sender: EmailSender = emailService,
  hubspot: HubspotClient = hubspotService,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== UserStatus.PENDING_APPROVAL) {
    throw ApiError.notFound("Pending signup not found", "SIGNUP_NOT_FOUND");
  }

  // The password was set during signup, so approval activates the account.
  // Guarded so two admins approving at once activate (and email) only once.
  const updated = await prisma.user.updateMany({
    where: { id: user.id, status: UserStatus.PENDING_APPROVAL },
    data: { status: UserStatus.ACTIVE },
  });
  if (updated.count === 0) {
    throw ApiError.notFound("Pending signup not found", "SIGNUP_NOT_FOUND");
  }
  const active = { ...user, status: UserStatus.ACTIVE };
  // Approved: the "you can sign in" email, and from here on a HubSpot lead
  await onAccountActivated(active, sender, hubspot);
  return presentUser(active);
}

export async function rejectSignup(
  userId: string,
  reason?: string,
  sender: EmailSender = emailService,
) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== UserStatus.PENDING_APPROVAL) {
    throw ApiError.notFound("Pending signup not found", "SIGNUP_NOT_FOUND");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    // Kept for audit; the same text goes into the email below
    data: {
      status: UserStatus.BLOCKED,
      blockReason: BlockReason.SIGNUP_REJECTED,
      rejectionReason: reason ?? null,
    },
  });
  // Best-effort: the decision stands even if the notification can't be sent
  try {
    await sender.sendSignupRejectedEmail(user.email, user.firstName, reason);
  } catch (err) {
    logger.warn(
      { err, userId: user.id },
      "signup rejected email failed; user is blocked regardless",
    );
  }
  return presentUser(updated);
}
