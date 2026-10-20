import { UserStatus } from "@prisma/client";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { presentUser } from "./auth.errors.js";
import {
  afterCursor,
  decodeCursor,
  encodeCursor,
  searchWhere,
} from "./admin-signups.utils.js";
import { issueSetPasswordToken } from "./set-password.service.js";
import { emailService, type EmailSender } from "../email/email.service.js";
import {
  hubspotService,
  syncHubspotContact,
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

  await prisma.user.update({
    where: { id: user.id },
    data: { status: UserStatus.PENDING_SET_PASSWORD },
  });
  try {
    await issueSetPasswordToken(user.id, sender);
  } catch (err) {
    await prisma.user
      .update({
        where: { id: user.id },
        data: { status: UserStatus.PENDING_APPROVAL },
      })
      .catch(() => undefined);
    throw err;
  }
  // Approved: from here on the person is a real lead in HubSpot
  await syncHubspotContact(user, "pending_password", hubspot);
  return presentUser({ ...user, status: UserStatus.PENDING_SET_PASSWORD });
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
    data: { status: UserStatus.BLOCKED },
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
