import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";

beforeAll(async () => {
  await resetDb();
});

describe("test database", () => {
  it("is connected via a -test database", async () => {
    const name = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
    expect(name).toMatch(/-test$/);
  });

  it("runs queries against the test database", async () => {
    const result = await prisma.$queryRaw<{ now: Date }[]>`SELECT now()`;

    expect(result).toHaveLength(1);
    expect(result[0].now).toBeInstanceOf(Date);
  });
});
