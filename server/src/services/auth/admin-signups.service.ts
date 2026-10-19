import { UserStatus } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { presentUser } from "./auth.errors.js";
import { issueSetPasswordToken } from "./set-password.service.js";
import { emailService, type EmailSender } from "../email/email.service.js";

export async function listPendingSignups() {
  const users = await prisma.user.findMany({
    where: { status: UserStatus.PENDING_APPROVAL },
    orderBy: { createdAt: "asc" },
  });
  return users.map(presentUser);
}

export async function approveSignup(
  userId: string,
  sender: EmailSender = emailService,
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
  return presentUser({ ...user, status: UserStatus.PENDING_SET_PASSWORD });
}

export async function rejectSignup(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.status !== UserStatus.PENDING_APPROVAL) {
    throw ApiError.notFound("Pending signup not found", "SIGNUP_NOT_FOUND");
  }
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { status: UserStatus.BLOCKED },
  });
  return presentUser(updated);
}
