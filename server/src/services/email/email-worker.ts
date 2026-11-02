import { EmailKind, UserStatus } from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  claimDue,
  completeBatchIfDone,
  LEASE_MS,
  markFailed,
  markRetry,
  markSent,
  nextDueAt,
  release,
  sentInLastDay,
  type OutboxRow,
} from "./email-outbox.service.js";
import { emailService } from "./email.service.js";
import type { SendFailureDetails } from "./email.utils.js";

// Sends the outbox in the API process: an async loop that spends its time
// awaiting OCI and the pace gap, so API requests keep being served. It runs
// only when kicked (after a rollback or publish, and at start-up) and sets
// one timer for the next retry; nothing runs at rest.

const MAX_BATCH = 25;
/** After a failed drain (e.g. the database dropped), try again this soon. */
const ERROR_RETRY_MS = 60_000;

/** Milliseconds between two sends at EMAIL_BULK_PER_MINUTE. */
export const paceGapMs = (perMinute: number) => 60_000 / perMinute;

/**
 * Rows to claim at once: no more than can be sent in 80% of the lease (the
 * rest is margin for OCI and the database), the batch size or the cap left.
 */
export const claimSize = (gapMs: number, capLeft: number) =>
  Math.max(
    0,
    Math.min(
      MAX_BATCH,
      Math.max(1, Math.floor((0.8 * LEASE_MS) / Math.max(gapMs, 1))),
      capLeft,
    ),
  );

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Per process: the pace and daily cap hold across drains
let lastSendAt = 0;

function retryable(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    (err.details as SendFailureDetails | undefined)?.retryable === true
  );
}

async function send(row: OutboxRow): Promise<void> {
  const p = row.payload as Record<string, string | null | undefined>;
  const firstName = p.firstName ?? "";
  // Looked up at call time, so tests can spy on emailService
  if (row.kind === EmailKind.RELEASE_WITHDRAWN) {
    await emailService.sendReleaseWithdrawnEmail(row.toEmail, firstName, {
      productName: p.productName ?? "EMASS SDK",
      withdrawnVersion: p.withdrawnVersion ?? "",
      replacementVersion: p.replacementVersion ?? null,
      url: p.url ?? "",
      customerMessage: p.customerMessage ?? undefined,
    });
  } else {
    await emailService.sendReleaseAnnouncedEmail(row.toEmail, firstName, {
      productName: p.productName ?? "EMASS SDK",
      version: p.version ?? "",
      url: p.url ?? "",
    });
  }
}

async function deliver(row: OutboxRow): Promise<void> {
  // Blocked or deleted since it was queued: they no longer get mail
  const user = row.userId
    ? await prisma.user.findUnique({
        where: { id: row.userId },
        select: { status: true },
      })
    : null;
  if (user?.status !== UserStatus.ACTIVE) {
    await markFailed(row, "User no longer active");
    return;
  }

  const wait = lastSendAt + paceGapMs(env.EMAIL_BULK_PER_MINUTE) - Date.now();
  if (wait > 0) await sleep(wait);
  lastSendAt = Date.now();
  try {
    await send(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err, outboxId: row.id, batchId: row.batchId, attempt: row.attempts },
      "bulk email failed",
    );
    if (retryable(err)) await markRetry(row, message);
    else await markFailed(row, message);
    return;
  }
  // Outside the try: the email went out, so a database error here must not
  // mark it failed. It propagates instead, and the drain retries later; the
  // row keeps its lease until then
  await markSent(row);
}

/**
 * Sends everything due, then returns. Safe to run in several processes at
 * once: each claim takes rows no other worker holds. Returns when the queue
 * has nothing due, the daily cap is reached, or `shouldStop()` says so.
 */
export async function drainOutbox(
  shouldStop: () => boolean = () => false,
): Promise<void> {
  while (!shouldStop()) {
    const { count, freesAt } = await sentInLastDay();
    const capLeft = env.EMAIL_BULK_DAILY_CAP - count;
    const size = claimSize(paceGapMs(env.EMAIL_BULK_PER_MINUTE), capLeft);
    if (size === 0) {
      logger.info({ freesAt }, "bulk email daily cap reached; waiting");
      return;
    }

    const rows = await claimDue(size);
    if (rows.length === 0) return;

    for (const [index, row] of rows.entries()) {
      if (shouldStop()) {
        // Hand the rest back untouched for the next start
        for (const left of rows.slice(index)) await release(left, new Date());
        return;
      }
      await deliver(row);
      await completeBatchIfDone(row.batchId);
    }
  }
}

let draining: Promise<void> | null = null;
let kickedWhileDraining = false;
let stopping = false;
let timer: NodeJS.Timeout | undefined;

/** Sets one timer for when the next row is due (a retry, or the cap freeing up). */
async function scheduleNext(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  if (stopping) return;
  const [due, { count, freesAt }] = await Promise.all([
    nextDueAt(),
    sentInLastDay(),
  ]);
  if (!due) return;
  const capped = count >= env.EMAIL_BULK_DAILY_CAP && freesAt;
  const at = capped
    ? Math.max(due.getTime(), freesAt.getTime())
    : due.getTime();
  // setTimeout caps at ~24.8 days; nothing here waits that long
  timer = setTimeout(kick, Math.max(at - Date.now(), 0) + 50);
  timer.unref();
}

/** Starts a drain unless one is running; a running drain is told to look again. */
export function kick(): void {
  if (stopping) return;
  if (draining) {
    kickedWhileDraining = true;
    return;
  }
  draining = drainOutbox(() => stopping)
    .then(scheduleNext)
    .catch((err: unknown) => {
      // A database blip mid-drain: try again soon, or nothing would send
      // until the next rollback, publish or restart
      logger.error({ err }, "bulk email drain failed; retrying in 60 s");
      clearTimeout(timer);
      if (!stopping) {
        timer = setTimeout(kick, ERROR_RETRY_MS);
        timer.unref();
      }
    })
    .finally(() => {
      draining = null;
      if (kickedWhileDraining) {
        kickedWhileDraining = false;
        kick();
      }
    });
}

/** Resolves once no drain is running (tests, shutdown). */
export async function settled(): Promise<void> {
  while (draining) await draining;
}

/** Stops after the current send; unsent rows wait for the next start. */
export async function stop(): Promise<void> {
  stopping = true;
  clearTimeout(timer);
  await settled();
}

export const emailWorker = { kick, settled, stop };
