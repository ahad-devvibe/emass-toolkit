import {
  EmailKind,
  EmailStatus,
  Prisma,
  ReleaseEventType,
} from "@prisma/client";
import { prisma } from "../../configs/prisma.js";

// Postgres is the queue for bulk mail: every email is a row first, and the
// worker (email-worker.ts) sends the rows at a set pace. Rows are queued in
// the same transaction as the rollback or publish that causes them, so both
// happen or neither does. See docs/operations/email-outbox.md.

type Db = Prisma.TransactionClient | typeof prisma;

/** Sends before a row gives up; counted at claim, so a crash mid-send counts. */
export const MAX_ATTEMPTS = 5;
/** Wait before retry n (1-based): 1 min, 5 min, 30 min, 2 h. */
export const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000];
/** How long a claimed row is a worker's own; another may re-claim it after. */
export const LEASE_MS = 5 * 60_000;

const PRIORITY = { rollback: 0, announcement: 10 } as const;

export function backoffMs(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
}

export interface OutboxRow {
  id: string;
  kind: EmailKind;
  batchId: string;
  userId: string | null;
  toEmail: string;
  payload: Record<string, unknown>;
  attempts: number;
  /** This claim's lease: marks only apply while the row is still ours. */
  leaseEnd: Date;
}

/** Everything a rollback notice needs except the person's name. */
export interface RollbackNoticePayload {
  productName: string;
  withdrawnVersion: string;
  replacementVersion: string | null;
  url: string;
  customerMessage?: string;
}

/** Everything a release announcement needs except the person's name. */
export interface AnnouncementPayload {
  productName: string;
  version: string;
  url: string;
}

// Timestamps are written and compared as UTC wall-clock values, the way
// Prisma stores DateTime (TIMESTAMP without time zone). Postgres now() and
// column defaults follow the session time zone instead, so they're avoided
const utc = (date: Date) => Prisma.sql`${date.toISOString()}::timestamp`;

// One INSERT … SELECT per event: everyone at once, in one round trip.
// ON CONFLICT makes a repeated enqueue a no-op for anyone already queued
function enqueue(
  db: Db,
  kind: EmailKind,
  priority: number,
  batchId: string,
  payload: object,
  audience: Prisma.Sql,
): Promise<number> {
  const now = utc(new Date());
  return db.$executeRaw`
    INSERT INTO "EmailOutbox" ("id", "kind", "priority", "batchId", "userId", "toEmail", "payload", "nextAttemptAt", "createdAt")
    SELECT gen_random_uuid(), ${kind}::"EmailKind", ${priority}, ${batchId}, u."id", u."email",
           jsonb_build_object('firstName', u."firstName") || ${JSON.stringify(payload)}::jsonb,
           ${now}, ${now}
    FROM "User" u
    WHERE u."status" = 'ACTIVE'::"UserStatus" AND EXISTS (${audience})
    ON CONFLICT ("batchId", "toEmail") DO NOTHING`;
}

/** Queues a rollback notice for each active customer who downloaded the release. */
export function enqueueRollbackNotices(
  db: Db,
  input: { batchId: string; releaseId: string; payload: RollbackNoticePayload },
): Promise<number> {
  return enqueue(
    db,
    EmailKind.RELEASE_WITHDRAWN,
    PRIORITY.rollback,
    input.batchId,
    input.payload,
    Prisma.sql`SELECT 1 FROM "Download" d WHERE d."userId" = u."id" AND d."releaseId" = ${input.releaseId}`,
  );
}

/**
 * Queues an announcement for each active customer who downloaded any other
 * release of the product. (Opting out comes later.)
 */
export function enqueueReleaseAnnouncement(
  db: Db,
  input: {
    batchId: string;
    productId: string;
    releaseId: string;
    payload: AnnouncementPayload;
  },
): Promise<number> {
  return enqueue(
    db,
    EmailKind.RELEASE_ANNOUNCED,
    PRIORITY.announcement,
    input.batchId,
    input.payload,
    Prisma.sql`SELECT 1 FROM "Download" d JOIN "Release" r ON r."id" = d."releaseId"
               WHERE d."userId" = u."id" AND r."productId" = ${input.productId} AND r."id" <> ${input.releaseId}`,
  );
}

/**
 * Takes up to `limit` due rows for this worker: SKIP LOCKED gives concurrent
 * workers different rows, and the lease lets another take them over if this
 * one dies. Due = pending and past its retry time, or sending with an
 * expired lease. Reads the partial index of unsent rows only.
 */
export async function claimDue(limit: number): Promise<OutboxRow[]> {
  const at = new Date();
  const now = utc(at);
  const leaseEnd = new Date(at.getTime() + LEASE_MS);
  const rows = await prisma.$queryRaw<
    (Omit<OutboxRow, "leaseEnd"> & { priority: number; createdAt: Date })[]
  >`
    UPDATE "EmailOutbox"
    SET "status" = 'SENDING', "attempts" = "attempts" + 1, "lockedUntil" = ${utc(leaseEnd)}
    WHERE "id" IN (
      SELECT "id" FROM "EmailOutbox"
      WHERE "status" IN ('PENDING', 'SENDING')
        AND "nextAttemptAt" <= ${now}
        AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
      ORDER BY "priority", "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "kind", "batchId", "userId", "toEmail", "payload", "attempts", "priority", "createdAt"`;
  // RETURNING has no order of its own: send in the order they were picked
  return rows
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    )
    .map((row) => ({ ...row, leaseEnd }));
}

// Every mark is conditional on the lease this worker took: if it ran out and
// another worker re-claimed the row, that worker owns the outcome now
const owned = (row: OutboxRow) => ({
  id: row.id,
  lockedUntil: row.leaseEnd,
});

export async function markSent(row: OutboxRow): Promise<void> {
  await prisma.emailOutbox.updateMany({
    where: owned(row),
    data: {
      status: EmailStatus.SENT,
      sentAt: new Date(),
      lockedUntil: null,
      lastError: null,
    },
  });
}

export async function markFailed(row: OutboxRow, error: string): Promise<void> {
  await prisma.emailOutbox.updateMany({
    where: owned(row),
    data: { status: EmailStatus.FAILED, lockedUntil: null, lastError: error },
  });
}

/** A retryable failure: try again after the backoff, or give up after the last attempt. */
export async function markRetry(row: OutboxRow, error: string): Promise<void> {
  if (row.attempts >= MAX_ATTEMPTS) return markFailed(row, error);
  await prisma.emailOutbox.updateMany({
    where: owned(row),
    data: {
      status: EmailStatus.PENDING,
      lockedUntil: null,
      lastError: error,
      nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)),
    },
  });
}

/** Puts a claimed row back unsent (daily cap, shutdown); the claim doesn't count. */
export async function release(row: OutboxRow, notBefore: Date): Promise<void> {
  await prisma.emailOutbox.updateMany({
    where: owned(row),
    data: {
      status: EmailStatus.PENDING,
      lockedUntil: null,
      attempts: { decrement: 1 },
      nextAttemptAt: notBefore,
    },
  });
}

/** Bulk emails sent in the last 24 h, and when the oldest of them stops counting. */
export async function sentInLastDay(): Promise<{
  count: number;
  freesAt: Date | null;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [count, oldest] = await Promise.all([
    prisma.emailOutbox.count({ where: { sentAt: { gt: since } } }),
    prisma.emailOutbox.findFirst({
      where: { sentAt: { gt: since } },
      orderBy: { sentAt: "asc" },
      select: { sentAt: true },
    }),
  ]);
  const freesAt = oldest?.sentAt
    ? new Date(oldest.sentAt.getTime() + 24 * 60 * 60_000)
    : null;
  return { count, freesAt };
}

/** When the next row becomes due (a retry time or an expiring lease), if any. */
export async function nextDueAt(): Promise<Date | null> {
  // Typed queries, so Prisma reads the UTC timestamps back correctly
  const [pending, sending] = await Promise.all([
    prisma.emailOutbox.findFirst({
      where: { status: EmailStatus.PENDING },
      orderBy: { nextAttemptAt: "asc" },
      select: { nextAttemptAt: true },
    }),
    prisma.emailOutbox.findFirst({
      where: { status: EmailStatus.SENDING },
      orderBy: { lockedUntil: "asc" },
      select: { lockedUntil: true },
    }),
  ]);
  const times = [pending?.nextAttemptAt, sending?.lockedUntil].filter(
    (at): at is Date => at instanceof Date,
  );
  return times.length ? new Date(Math.min(...times.map(Number))) : null;
}

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Id of a batch's summary event: fixed, so it's written at most once. */
export const summaryEventId = (batchId: string) => `notified-${batchId}`;

/**
 * Once nothing in the batch is left to send, records the outcome on the
 * release as one CUSTOMERS_NOTIFIED event, by the admin whose rollback or
 * publish started it (the batch id is that event's id). An announcement
 * that reached nobody records nothing.
 */
export async function completeBatchIfDone(batchId: string): Promise<void> {
  const groups = await prisma.emailOutbox.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });
  const count = (status: EmailStatus) =>
    groups.find((group) => group.status === status)?._count._all ?? 0;
  if (count(EmailStatus.PENDING) + count(EmailStatus.SENDING) > 0) return;

  const cause = await prisma.releaseEvent.findUnique({
    where: { id: batchId },
    select: {
      type: true,
      actorId: true,
      releaseId: true,
      release: { select: { version: true } },
    },
  });
  if (!cause) return;
  const sent = count(EmailStatus.SENT);
  const failed = count(EmailStatus.FAILED);
  const version = `v${cause.release.version ?? ""}`;
  const failedNote = failed ? ` (${failed} failed)` : "";

  let note: string;
  if (cause.type === ReleaseEventType.ROLLED_BACK) {
    note =
      sent + failed === 0
        ? `No customers had downloaded ${version}.`
        : `Emailed ${plural(sent, "customer")} who downloaded ${version}${failedNote}.`;
  } else {
    if (sent + failed === 0) return;
    note = `Announced ${version} to ${plural(sent, "customer")}${failedNote}.`;
  }

  try {
    await prisma.releaseEvent.create({
      data: {
        id: summaryEventId(batchId),
        releaseId: cause.releaseId,
        type: ReleaseEventType.CUSTOMERS_NOTIFIED,
        actorId: cause.actorId,
        note,
      },
    });
  } catch (err) {
    // Another worker finished the same batch first
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return;
    }
    throw err;
  }
}
