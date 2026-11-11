import { UserStatus } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { ALERT_LIMIT, summarizeUsers } from "./dashboard.utils.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * GET /admin/dashboard: counts plus what waits for an admin. Downloads are
 * customer ones only (staff downloads go to ActivityLog). Alerts are the
 * current queues (they clear once handled), not stored notifications. One
 * round of parallel queries; the page polls it. Sign-in logs (AuthEvent) are
 * recorded but deliberately not read here: they grow without bound.
 */
export async function getDashboard(now = new Date()) {
  const pending = { status: UserStatus.PENDING_APPROVAL };

  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [userGroups, signupQueue, downloadTotal, recentDownloads] =
    await Promise.all([
      prisma.user.groupBy({
        by: ["status", "role", "blockReason"],
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: pending,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: ALERT_LIMIT,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          country: true,
          createdAt: true,
        },
      }),
      prisma.download.count(),
      prisma.download.count({ where: { createdAt: { gte: monthAgo } } }),
    ]);
  const users = summarizeUsers(userGroups);

  return {
    users,
    downloads: { total: downloadTotal, last30Days: recentDownloads },
    signupAlerts: { total: users.pendingApproval, items: signupQueue },
    generatedAt: now,
  };
}
