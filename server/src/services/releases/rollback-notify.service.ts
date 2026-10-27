import { ReleaseEventType, UserStatus } from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { emailService, type EmailSender } from "../email/email.service.js";

export interface RollbackNotice {
  releaseId: string;
  productId: string;
  withdrawnVersion: string;
  /** Restored or current published version to point people to; null when none. */
  replacementVersion: string | null;
  /** Optional admin note written for customers; the internal reason never goes out. */
  customerMessage?: string;
  actorId: string;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Emails everyone who downloaded a rolled-back release (customers only:
 * Download holds no staff rows), once per person, then records the outcome
 * as a CUSTOMERS_NOTIFIED event. Runs after the rollback commits; failures
 * are logged per recipient and never undo the rollback.
 */
export async function notifyRollbackDownloaders(
  notice: RollbackNotice,
  sender: EmailSender = emailService,
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  try {
    const [product, downloads] = await Promise.all([
      prisma.product.findUnique({
        where: { id: notice.productId },
        select: { name: true },
      }),
      prisma.download.findMany({
        where: { releaseId: notice.releaseId },
        distinct: ["userId"],
        select: {
          user: { select: { email: true, firstName: true, status: true } },
        },
      }),
    ]);
    const base = env.APP_BASE_URL.replace(/\/+$/, "");
    const url = notice.replacementVersion
      ? `${base}/catalog/${notice.productId}`
      : `${base}/catalog`;
    const recipients = downloads
      .map((row) => row.user)
      .filter((user) => user.status === UserStatus.ACTIVE);

    for (const user of recipients) {
      try {
        await sender.sendReleaseWithdrawnEmail(user.email, user.firstName, {
          productName: product?.name ?? "EMASS SDK",
          withdrawnVersion: notice.withdrawnVersion,
          replacementVersion: notice.replacementVersion,
          url,
          customerMessage: notice.customerMessage,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        logger.warn(
          { err, email: user.email, releaseId: notice.releaseId },
          "rollback email failed",
        );
      }
    }

    const version = `v${notice.withdrawnVersion}`;
    await prisma.releaseEvent.create({
      data: {
        releaseId: notice.releaseId,
        type: ReleaseEventType.CUSTOMERS_NOTIFIED,
        actorId: notice.actorId,
        note:
          recipients.length === 0
            ? `No customers had downloaded ${version}.`
            : `Emailed ${plural(sent, "customer")} who downloaded ${version}${failed ? ` (${failed} failed)` : ""}.`,
      },
    });
  } catch (err) {
    logger.error(
      { err, releaseId: notice.releaseId },
      "rollback notifications failed",
    );
  }
  return { sent, failed };
}

const running = new Set<Promise<unknown>>();

/**
 * Starts the notifications without waiting for them: the admin gets the
 * rollback response at once. `rollbackNotificationsSettled` waits for them.
 */
export function startRollbackNotifications(
  notice: RollbackNotice,
  sender: EmailSender = emailService,
): void {
  const job = notifyRollbackDownloaders(notice, sender).finally(() =>
    running.delete(job),
  );
  running.add(job);
}

/** Resolves once every notification started so far has finished (tests). */
export async function rollbackNotificationsSettled(): Promise<void> {
  await Promise.allSettled([...running]);
}
