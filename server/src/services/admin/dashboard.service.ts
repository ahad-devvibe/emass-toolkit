import { ReleaseEventType, ReleaseStatus, UserStatus } from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { actorSelect, presentActor } from "../releases/releases.presenter.js";
import { ALERT_LIMIT, summarizeUsers } from "./dashboard.utils.js";

/**
 * GET /admin/dashboard: counts plus what waits for an admin. Alerts are the
 * current queues (they clear once handled), not stored notifications. One
 * round of parallel queries; the page polls it. Sign-in logs (AuthEvent) are
 * recorded but deliberately not read here: they grow without bound.
 */
export async function getDashboard(now = new Date()) {
  const inReview = { status: ReleaseStatus.IN_REVIEW };
  const pending = { status: UserStatus.PENDING_APPROVAL };

  const [userGroups, reviewTotal, reviewQueue, signupQueue] = await Promise.all(
    [
      prisma.user.groupBy({
        by: ["status", "role", "blockReason"],
        _count: { _all: true },
      }),
      prisma.release.count({ where: inReview }),
      // Nothing edits a release in review, so updatedAt is when it was submitted
      prisma.release.findMany({
        where: inReview,
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: ALERT_LIMIT,
        select: {
          id: true,
          version: true,
          updatedAt: true,
          product: { select: { id: true, name: true } },
          createdBy: { select: actorSelect },
          events: {
            where: { type: ReleaseEventType.SUBMITTED },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
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
    ],
  );
  const users = summarizeUsers(userGroups);

  return {
    users,
    releases: { inReview: reviewTotal },
    releaseAlerts: {
      total: reviewTotal,
      items: reviewQueue.map((release) => ({
        id: release.id,
        product: release.product,
        version: release.version,
        createdBy: presentActor(release.createdBy),
        submittedAt: release.events[0]?.createdAt ?? release.updatedAt,
      })),
    },
    signupAlerts: { total: users.pendingApproval, items: signupQueue },
    generatedAt: now,
  };
}
