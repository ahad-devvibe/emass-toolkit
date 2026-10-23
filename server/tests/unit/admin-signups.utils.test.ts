import { describe, expect, it } from "vitest";
import {
  afterCursor,
  searchWhere,
} from "../../src/services/auth/admin-signups.utils.js";

describe("signup afterCursor", () => {
  it("selects rows strictly after the cursor", () => {
    const createdAt = new Date("2026-10-19T00:00:00.000Z");
    expect(afterCursor({ createdAt, id: "b" })).toEqual({
      OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: "b" } }],
    });
  });
});

describe("searchWhere", () => {
  it("is empty without a query", () => {
    expect(searchWhere(undefined)).toEqual({});
    expect(searchWhere("   ")).toEqual({});
  });

  it("requires every term to match a name part or the email", () => {
    const where = searchWhere("  Jane   doe ") as {
      AND: { OR: Record<string, unknown>[] }[];
    };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR).toContainEqual({
      email: { contains: "Jane", mode: "insensitive" },
    });
    expect(where.AND[1].OR).toContainEqual({
      lastName: { contains: "doe", mode: "insensitive" },
    });
  });
});
