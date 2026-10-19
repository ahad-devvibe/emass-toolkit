import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";

beforeAll(async () => {
  await resetDb();
});

describe("test database", () => {
  it("is connected via a _test DATABASE_URL", async () => {
    expect(process.env.DATABASE_URL).toContain("_test");
  });

  it("runs queries against the held_test database", async () => {
    const result = await prisma.$queryRaw<{ now: Date }[]>`SELECT now()`;

    expect(result).toHaveLength(1);
    expect(result[0].now).toBeInstanceOf(Date);
  });
});
