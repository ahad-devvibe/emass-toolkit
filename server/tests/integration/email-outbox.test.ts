import { ReleaseEventType, type ReleaseStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import {
  completeBatchIfDone,
  enqueueReleaseAnnouncement,
  enqueueRollbackNotices,
  MAX_ATTEMPTS,
} from "../../src/services/email/email-outbox.service.js";
import { drainOutbox } from "../../src/services/email/email-worker.js";
import { emailService } from "../../src/services/email/email.service.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { createUser, uniqueEmail } from "../helpers/auth.js";
import {
  createAdmin,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";
import { resetDb } from "../helpers/resetDb.js";

let dev: StaffUser;
let admin: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  admin = await createAdmin();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const retryableError = () =>
  new ApiError(502, "Unable to send", "EMAIL_SEND_FAILED", {
    retryable: true,
    providerStatus: 429,
  });

function spySends() {
  const order: string[] = [];
  const withdrawn = vi
    .spyOn(emailService, "sendReleaseWithdrawnEmail")
    .mockImplementation(async (email) => {
      order.push(`withdrawn:${email}`);
    });
  const announced = vi
    .spyOn(emailService, "sendReleaseAnnouncedEmail")
    .mockImplementation(async (email) => {
      order.push(`announced:${email}`);
    });
  return { withdrawn, announced, order };
}

async function release(
  version: string,
  status: ReleaseStatus,
  productId?: string,
) {
  const product = productId ? { id: productId } : await createProduct();
  return createRelease({
    productId: product.id,
    createdById: dev.id,
    version,
    status,
  });
}

async function downloader(releaseId: string, times = 1, status = "ACTIVE") {
  const user = await createUser(uniqueEmail("dl"), {
    status: status as "ACTIVE",
  });
  for (let i = 0; i < times; i++) {
    await prisma.download.create({ data: { userId: user.id, releaseId } });
  }
  return user;
}

/** The event a batch hangs off: ROLLED_BACK or PUBLISHED, by the admin. */
function causeEvent(releaseId: string, type: ReleaseEventType) {
  return prisma.releaseEvent.create({
    data: { releaseId, type, actorId: admin.id },
  });
}

async function rollbackBatch(releaseId: string) {
  const event = await causeEvent(releaseId, ReleaseEventType.ROLLED_BACK);
  const queued = await enqueueRollbackNotices(prisma, {
    batchId: event.id,
    releaseId,
    payload: {
      productName: "EMASS Core SDK",
      withdrawnVersion: "1.1.0",
      replacementVersion: "1.0.0",
      url: "https://portal.example/catalog/p",
    },
  });
  return { batchId: event.id, queued };
}

const rows = (batchId: string) =>
  prisma.emailOutbox.findMany({
    where: { batchId },
    orderBy: { toEmail: "asc" },
  });

const summary = (releaseId: string) =>
  prisma.releaseEvent.findMany({
    where: { releaseId, type: ReleaseEventType.CUSTOMERS_NOTIFIED },
  });

describe("rollback notices", () => {
  it("queues each active downloader once and sends them", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    const twice = await downloader(current.id, 2);
    const once = await downloader(current.id);
    await downloader(current.id, 1, "BLOCKED");

    const { batchId, queued } = await rollbackBatch(current.id);
    expect(queued).toBe(2);

    await drainOutbox();

    expect(withdrawn.mock.calls.map(([email]) => email).sort()).toEqual(
      [twice.email, once.email].sort(),
    );
    expect(withdrawn.mock.calls[0][2]).toEqual({
      productName: "EMASS Core SDK",
      withdrawnVersion: "1.1.0",
      replacementVersion: "1.0.0",
      url: "https://portal.example/catalog/p",
      customerMessage: undefined,
    });
    expect((await rows(batchId)).map((row) => row.status)).toEqual([
      "SENT",
      "SENT",
    ]);
    expect(await summary(current.id)).toMatchObject([
      {
        actorId: admin.id,
        note: "Emailed 2 customers who downloaded v1.1.0.",
      },
    ]);
  });

  it("queues nothing twice when the enqueue repeats", async () => {
    spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    const event = await causeEvent(current.id, ReleaseEventType.ROLLED_BACK);
    const input = {
      batchId: event.id,
      releaseId: current.id,
      payload: {
        productName: "X",
        withdrawnVersion: "1.1.0",
        replacementVersion: null,
        url: "u",
      },
    };

    expect(await enqueueRollbackNotices(prisma, input)).toBe(1);
    expect(await enqueueRollbackNotices(prisma, input)).toBe(0);
    await drainOutbox();
  });
});

describe("release announcements", () => {
  it("goes to active downloaders of any other release of the product, once each", async () => {
    const { announced } = spySends();
    const older = await release("1.0.0", "ARCHIVED");
    const current = await release("1.1.0", "PUBLISHED", older.productId);
    const fresh = await release("2.0.0", "PUBLISHED", older.productId);
    const a = await downloader(older.id);
    const b = await downloader(current.id, 3);
    await prisma.download.create({
      data: { userId: b.id, releaseId: older.id },
    });
    await downloader(older.id, 1, "BLOCKED");
    await downloader(fresh.id); // only the new one: nothing to announce
    await downloader((await release("9.0.0", "PUBLISHED")).id); // other product

    const event = await causeEvent(fresh.id, ReleaseEventType.PUBLISHED);
    const queued = await enqueueReleaseAnnouncement(prisma, {
      batchId: event.id,
      productId: older.productId,
      releaseId: fresh.id,
      payload: { productName: "EMASS Core SDK", version: "2.0.0", url: "u" },
    });
    expect(queued).toBe(2);

    await drainOutbox();

    expect(announced.mock.calls.map(([email]) => email).sort()).toEqual(
      [a.email, b.email].sort(),
    );
    expect(announced.mock.calls[0][2]).toEqual({
      productName: "EMASS Core SDK",
      version: "2.0.0",
      url: "u",
    });
    expect(await summary(fresh.id)).toMatchObject([
      { note: "Announced v2.0.0 to 2 customers." },
    ]);
  });

  it("records nothing when nobody downloaded the product before", async () => {
    const fresh = await release("1.0.0", "PUBLISHED");
    const event = await causeEvent(fresh.id, ReleaseEventType.PUBLISHED);

    await completeBatchIfDone(event.id);

    expect(await summary(fresh.id)).toEqual([]);
  });

  it("sends rollback notices before announcements", async () => {
    const { order } = spySends();
    const fresh = await release("2.0.0", "PUBLISHED");
    const older = await release("1.0.0", "ARCHIVED", fresh.productId);
    const fan = await downloader(older.id);
    const event = await causeEvent(fresh.id, ReleaseEventType.PUBLISHED);
    await enqueueReleaseAnnouncement(prisma, {
      batchId: event.id,
      productId: fresh.productId,
      releaseId: fresh.id,
      payload: { productName: "P", version: "2.0.0", url: "u" },
    });
    const bad = await release("1.1.0", "ROLLED_BACK");
    const victim = await downloader(bad.id);
    await rollbackBatch(bad.id);

    await drainOutbox();

    expect(order).toEqual([
      `withdrawn:${victim.email}`,
      `announced:${fan.email}`,
    ]);
  });
});

describe("recipients", () => {
  it("emails customers only, never staff who downloaded as customers", async () => {
    const older = await release("1.0.0", "ARCHIVED");
    const withdrawn = await release("1.1.0", "ROLLED_BACK", older.productId);
    const fresh = await release("2.0.0", "PUBLISHED", older.productId);
    const customer = await downloader(withdrawn.id);
    // Downloaded while a customer, promoted to staff since
    const promoted = await downloader(withdrawn.id);
    await prisma.user.update({
      where: { id: promoted.id },
      data: { role: "DEV" },
    });

    const rollback = await rollbackBatch(withdrawn.id);
    const event = await causeEvent(fresh.id, ReleaseEventType.PUBLISHED);
    const announced = await enqueueReleaseAnnouncement(prisma, {
      batchId: event.id,
      productId: older.productId,
      releaseId: fresh.id,
      payload: { productName: "EMASS Core SDK", version: "2.0.0", url: "u" },
    });

    expect(rollback.queued).toBe(1);
    expect(announced).toBe(1);
    expect((await rows(rollback.batchId)).map((row) => row.toEmail)).toEqual([
      customer.email,
    ]);
    expect((await rows(event.id)).map((row) => row.toEmail)).toEqual([
      customer.email,
    ]);
    // Leave nothing due for later tests
    await prisma.emailOutbox.updateMany({
      where: { status: "PENDING" },
      data: { status: "FAILED" },
    });
  });
});

describe("failures, retries and limits", () => {
  it("retries a throttled send later, then sends it", async () => {
    const { withdrawn } = spySends();
    withdrawn.mockRejectedValueOnce(retryableError());
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);

    await drainOutbox();
    let [row] = await rows(batchId);
    expect(row).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    expect(await summary(current.id)).toEqual([]);

    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await drainOutbox();
    [row] = await rows(batchId);
    expect(row).toMatchObject({ status: "SENT", attempts: 2 });
    expect(withdrawn).toHaveBeenCalledTimes(2);
  });

  it("gives up on a bad address, and after the last attempt", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);
    const [first, second] = await rows(batchId);
    // The second has used its other attempts already
    await prisma.emailOutbox.update({
      where: { id: second.id },
      data: { attempts: MAX_ATTEMPTS - 1 },
    });
    withdrawn.mockImplementation(async (email) => {
      throw email === first.toEmail
        ? new ApiError(502, "bad address", "EMAIL_SEND_FAILED", {
            retryable: false,
            providerStatus: 400,
          })
        : retryableError();
    });

    await drainOutbox();

    expect((await rows(batchId)).map((row) => row.status)).toEqual([
      "FAILED",
      "FAILED",
    ]);
    expect(await summary(current.id)).toMatchObject([
      { note: "Emailed 0 customers who downloaded v1.1.0 (2 failed)." },
    ]);
  });

  it("skips someone blocked after being queued", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    const user = await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "BLOCKED" },
    });

    await drainOutbox();

    expect(withdrawn).not.toHaveBeenCalled();
    expect(await rows(batchId)).toMatchObject([
      { status: "FAILED", lastError: "User no longer active" },
    ]);
  });

  it("sends each email once when two workers drain at the same time", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    for (let i = 0; i < 12; i++) await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);

    await Promise.all([drainOutbox(), drainOutbox()]);

    const emails = withdrawn.mock.calls.map(([email]) => email);
    expect(emails).toHaveLength(12);
    expect(new Set(emails).size).toBe(12);
    expect(await summary(current.id)).toHaveLength(1);
    expect((await rows(batchId)).every((row) => row.status === "SENT")).toBe(
      true,
    );
  }, 15_000); // 12 sign-ups with password hashing take ~5 s

  it("takes over a row whose worker died mid-send", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);
    await prisma.emailOutbox.updateMany({
      where: { batchId },
      data: {
        status: "SENDING",
        attempts: 1,
        lockedUntil: new Date(Date.now() - 1000),
      },
    });

    await drainOutbox();

    expect(withdrawn).toHaveBeenCalledTimes(1);
    expect(await rows(batchId)).toMatchObject([
      { status: "SENT", attempts: 2 },
    ]);
  });

  it("gives up on a row whose last attempt never finished", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);
    // Its fifth send hung or the process died, and the lease ran out
    await prisma.emailOutbox.updateMany({
      where: { batchId },
      data: {
        status: "SENDING",
        attempts: MAX_ATTEMPTS,
        lockedUntil: new Date(Date.now() - 1000),
      },
    });

    await drainOutbox();

    expect(withdrawn).not.toHaveBeenCalled();
    expect(await rows(batchId)).toMatchObject([
      {
        status: "FAILED",
        attempts: MAX_ATTEMPTS,
        lockedUntil: null,
        lastError: `Gave up after ${MAX_ATTEMPTS} attempts`,
      },
    ]);
    expect(await summary(current.id)).toMatchObject([
      { note: "Emailed 0 customers who downloaded v1.1.0 (1 failed)." },
    ]);
  });

  it("stops at the daily cap and leaves the rest queued", async () => {
    const { withdrawn } = spySends();
    const cap = env.EMAIL_BULK_DAILY_CAP;
    const sentToday = await prisma.emailOutbox.count({
      where: { sentAt: { gt: new Date(Date.now() - 86_400_000) } },
    });
    env.EMAIL_BULK_DAILY_CAP = sentToday + 1;
    try {
      const current = await release("1.1.0", "ROLLED_BACK");
      for (let i = 0; i < 3; i++) await downloader(current.id);
      const { batchId } = await rollbackBatch(current.id);

      await drainOutbox();

      expect(withdrawn).toHaveBeenCalledTimes(1);
      const statuses = (await rows(batchId)).map((row) => row.status).sort();
      expect(statuses).toEqual(["PENDING", "PENDING", "SENT"]);
      expect(await summary(current.id)).toEqual([]);
    } finally {
      env.EMAIL_BULK_DAILY_CAP = cap;
      // Leave nothing due for later tests
      await prisma.emailOutbox.updateMany({
        where: { status: "PENDING" },
        data: { status: "FAILED" },
      });
    }
  });
});

describe("database errors and stale leases", () => {
  it("never marks a sent email failed when recording it errors", async () => {
    const { withdrawn } = spySends();
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);
    const updateMany = prisma.emailOutbox.updateMany.bind(prisma.emailOutbox);
    const spy = vi
      .spyOn(prisma.emailOutbox, "updateMany")
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockImplementation(updateMany);

    await expect(drainOutbox()).rejects.toThrow("connection reset");

    // Sent but unrecorded: still leased, never FAILED
    let [row] = await rows(batchId);
    expect(row.status).toBe("SENDING");
    expect(withdrawn).toHaveBeenCalledTimes(1);
    expect(await summary(current.id)).toEqual([]);

    // Once the lease runs out it's sent again (at least once) and recorded
    spy.mockRestore();
    await prisma.emailOutbox.update({
      where: { id: row.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await drainOutbox();
    [row] = await rows(batchId);
    expect(row.status).toBe("SENT");
    expect(await summary(current.id)).toHaveLength(1);
  });

  it("leaves a row alone once another worker has taken it over", async () => {
    const current = await release("1.1.0", "ROLLED_BACK");
    await downloader(current.id);
    const { batchId } = await rollbackBatch(current.id);
    const takenOver = new Date(Date.now() + 10 * 60_000);
    // While this worker sends, its lease runs out and another re-claims
    vi.spyOn(emailService, "sendReleaseWithdrawnEmail").mockImplementation(
      async () => {
        await prisma.emailOutbox.updateMany({
          where: { batchId },
          data: { lockedUntil: takenOver },
        });
      },
    );

    await drainOutbox();

    expect(await rows(batchId)).toMatchObject([
      { status: "SENDING", sentAt: null, lockedUntil: takenOver },
    ]);
    // Leave nothing due for later tests
    await prisma.emailOutbox.updateMany({
      where: { batchId },
      data: { status: "FAILED", lockedUntil: null },
    });
  });
});
