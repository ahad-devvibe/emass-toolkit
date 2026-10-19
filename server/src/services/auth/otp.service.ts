import type { Prisma } from "@prisma/client";
import { OtpPurpose } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
  generateOtpCode,
  hashOtpCode,
  verifyOtpCode,
} from "./auth.utils.js";

export async function issueOtp(
  userId: string,
  purpose: OtpPurpose,
): Promise<string> {
  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  await prisma.$transaction([
    prisma.otp.deleteMany({
      where: { userId, purpose, consumedAt: null },
    }),
    prisma.otp.create({
      data: {
        userId,
        purpose,
        codeHash,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    }),
  ]);
  return code;
}

export type OtpRecord = NonNullable<
  Awaited<ReturnType<typeof prisma.otp.findFirst>>
>;

export async function checkOtp(
  userId: string,
  purpose: OtpPurpose,
  code: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<OtpRecord> {
  const otp = await client.otp.findFirst({
    where: { userId, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    throw new ApiError(400, "Invalid OTP", "OTP_INVALID");
  }
  if (otp.expiresAt.getTime() < Date.now()) {
    throw new ApiError(400, "OTP has expired", "OTP_EXPIRED");
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new ApiError(
      400,
      "Too many failed attempts — request a new OTP",
      "OTP_ATTEMPTS_EXCEEDED",
    );
  }
  if (!(await verifyOtpCode(code, otp.codeHash))) {
    await prisma.otp.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    throw new ApiError(400, "Invalid OTP", "OTP_INVALID");
  }

  return otp;
}

export async function verifyOtp(
  userId: string,
  purpose: OtpPurpose,
  code: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const otp = await checkOtp(userId, purpose, code, client);
  await client.otp.update({
    where: { id: otp.id },
    data: { consumedAt: new Date() },
  });
}
