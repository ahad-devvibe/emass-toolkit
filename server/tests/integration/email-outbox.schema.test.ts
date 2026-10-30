import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/configs/prisma.js";
import { createUser } from "../helpers/auth.js";
import { resetDb } from "../helpers/resetDb.js";

beforeAll(resetDb);

const queue = (data: { batchId: string; toEmail: string; userId?: string }) =>
  prisma.emailOutbox.create({
    data: { kind: "RELEASE_WITHDRAWN", payload: { firstName: "Ada" }, ...data },
  });

describe("EmailOutbox table", () => {
  it("queues a row as PENDING with no attempts, due now", async () => {
    const before = Date.now();
    const row = await queue({
      batchId: randomUUID(),
      toEmail: "a@example.com",
    });

    expect(row).toMatchObject({
      status: "PENDING",
      attempts: 0,
      priority: 10,
      lockedUntil: null,
      sentAt: null,
    });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("refuses the same address twice in one batch", async () => {
    const batchId = randomUUID();
    await queue({ batchId, toEmail: "twice@example.com" });

    const again = queue({ batchId, toEmail: "twice@example.com" });

    await expect(again).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    await expect(again).rejects.toMatchObject({ code: "P2002" });
    // Another batch may email the same person
    await expect(
      queue({ batchId: randomUUID(), toEmail: "twice@example.com" }),
    ).resolves.toBeDefined();
  });

  it("keeps the record of an email when its user is deleted", async () => {
    const user = await createUser("gone@example.com");
    const row = await queue({
      batchId: randomUUID(),
      toEmail: user.email,
      userId: user.id,
    });

    await prisma.user.delete({ where: { id: user.id } });

    const kept = await prisma.emailOutbox.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(kept).toMatchObject({ userId: null, toEmail: "gone@example.com" });
  });

  it("indexes only the rows still to send for claiming", async () => {
    const [index] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'EmailOutbox' AND indexname = 'EmailOutbox_due_idx'
    `;

    // Postgres quotes only identifiers that need it: priority, "createdAt"
    expect(index?.indexdef).toMatch(/\(priority, "createdAt"\)/);
    expect(index?.indexdef).toMatch(/WHERE .*PENDING.*SENDING/);
  });
});
