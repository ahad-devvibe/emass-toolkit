import type { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  REFRESH_TOKEN_TTL_MS,
  generateAccessToken,
  generateRefreshToken,
  hashToken,
} from "./auth.utils.js";

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function issueTokenPair(
  userId: string,
  role: UserRole,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<TokenPair> {
  const refreshToken = generateRefreshToken();
  await client.$transaction([
    client.refreshToken.deleteMany({
      where: {
        userId,
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    }),
    client.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      },
    }),
  ]);
  return { accessToken: generateAccessToken(userId, role), refreshToken };
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { select: { role: true } } },
  });

  if (!row) {
    throw new ApiError(401, "Invalid refresh token", "REFRESH_TOKEN_INVALID");
  }
  if (row.revokedAt) {
    await revokeAllUserTokens(row.userId);
    throw new ApiError(
      401,
      "Refresh token has been reused",
      "REFRESH_TOKEN_REUSED",
    );
  }
  if (row.expiresAt.getTime() < Date.now()) {
    throw new ApiError(
      401,
      "Refresh token has expired",
      "REFRESH_TOKEN_EXPIRED",
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        throw new ApiError(
          401,
          "Refresh token has been reused",
          "REFRESH_TOKEN_REUSED",
        );
      }
      return issueTokenPair(row.userId, row.user.role, tx);
    });
  } catch (err) {
    if (err instanceof ApiError && err.code === "REFRESH_TOKEN_REUSED") {
      await revokeAllUserTokens(row.userId);
    }
    throw err;
  }
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revokedAt: new Date() },
  });
}
