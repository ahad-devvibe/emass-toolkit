import { describe, expect, it, vi, afterEach } from "vitest";
import type { Prisma } from "@prisma/client";
import { inlineSqlParams, onPrismaQuery } from "../../src/configs/prisma.js";
import { logger } from "../../src/configs/logger.js";

function queryEvent(
  query: string,
  params: string,
  duration = 2,
): Prisma.QueryEvent {
  return { query, params, duration } as Prisma.QueryEvent;
}

describe("inlineSqlParams", () => {
  it("substitutes strings with quoted, escaped values", () => {
    expect(
      inlineSqlParams(
        `SELECT * FROM "User" WHERE email = $1 AND name = $2`,
        JSON.stringify(["o'brien@example.com", "Ann"]),
      ),
    ).toBe(
      `SELECT * FROM "User" WHERE email = 'o''brien@example.com' AND name = 'Ann'`,
    );
  });

  it("substitutes numbers, booleans and null", () => {
    expect(
      inlineSqlParams(
        "SELECT * FROM t WHERE n = $1 AND ok = $2 AND gone = $3",
        JSON.stringify([42, true, null]),
      ),
    ).toBe("SELECT * FROM t WHERE n = 42 AND ok = true AND gone = NULL");
  });

  it("resolves multi-digit placeholders by full number ($10 not $1)", () => {
    const values = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(
      inlineSqlParams("SELECT $1, $10, $11, $2", JSON.stringify(values)),
    ).toBe("SELECT 1, 10, 11, 2");
  });

  it("does not rescan substituted values for placeholders", () => {
    expect(
      inlineSqlParams("SELECT $1", JSON.stringify(["costs $1 or $2"])),
    ).toBe("SELECT 'costs $1 or $2'");
  });

  it("returns null on invalid JSON", () => {
    expect(inlineSqlParams("SELECT $1", "not-json")).toBeNull();
  });

  it("returns null on non-array JSON", () => {
    expect(inlineSqlParams("SELECT $1", '{"a":1}')).toBeNull();
  });

  it("returns null when a placeholder index is out of range", () => {
    expect(inlineSqlParams("SELECT $3", "[1,2]")).toBeNull();
  });
});

describe("onPrismaQuery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the inlined query with duration", () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

    onPrismaQuery(
      queryEvent(`SELECT "id" FROM "User" WHERE "id" = $1`, `["abc"]`, 3),
    );

    expect(debug).toHaveBeenCalledWith(
      { duration: 3 },
      `SELECT "id" FROM "User" WHERE "id" = 'abc'`,
    );
  });

  it("falls back to raw query + params when inlining fails", () => {
    const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);

    onPrismaQuery(queryEvent("SELECT $1", "not-json", 5));

    expect(debug).toHaveBeenCalledWith(
      { duration: 5, params: "not-json" },
      "SELECT $1",
    );
  });
});
