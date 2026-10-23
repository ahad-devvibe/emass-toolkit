import { describe, expect, it } from "vitest";
import {
  afterCursor,
  compareVersions,
  findDuplicatePlatforms,
  formatVersion,
  parseVersion,
  releaseSearchWhere,
  suggestVersions,
  versionBelow,
} from "../../src/services/releases/releases.utils.js";

describe("parseVersion", () => {
  it("parses strict MAJOR.MINOR.PATCH", () => {
    expect(parseVersion("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
    expect(parseVersion("12.3.45")).toEqual({ major: 12, minor: 3, patch: 45 });
    expect(parseVersion("999999.0.0")).toEqual({
      major: 999999,
      minor: 0,
      patch: 0,
    });
  });

  it("rejects anything else", () => {
    for (const value of [
      "",
      "1",
      "1.2",
      "1.2.3.4",
      "v1.2.3",
      "01.2.3",
      "1.02.3",
      "1.2.03",
      " 1.2.3",
      "1.2.3-beta",
      "1.2.3+build",
      "-1.2.3",
      "1000000.0.0",
      "1.2.x",
    ]) {
      expect(parseVersion(value), value).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  const v = (value: string) => parseVersion(value)!;

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions(v("2.0.0"), v("1.9.9"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.10.0"), v("1.9.0"))).toBeGreaterThan(0);
    expect(compareVersions(v("1.0.2"), v("1.0.10"))).toBeLessThan(0);
    expect(compareVersions(v("1.2.3"), v("1.2.3"))).toBe(0);
  });

  it("round-trips through formatVersion", () => {
    expect(formatVersion(v("4.5.6"))).toBe("4.5.6");
  });
});

describe("suggestVersions", () => {
  it("starts from 0.0.0 when nothing exists", () => {
    expect(suggestVersions(null)).toEqual({
      patch: "0.0.1",
      minor: "0.1.0",
      major: "1.0.0",
    });
  });

  it("bumps and resets lower parts", () => {
    expect(suggestVersions(parseVersion("2.5.3"))).toEqual({
      patch: "2.5.4",
      minor: "2.6.0",
      major: "3.0.0",
    });
  });
});

describe("findDuplicatePlatforms", () => {
  it("lists platforms claimed by more than one file", () => {
    const files = new Map([
      ["a", { platform: "WINDOWS" as const }],
      ["b", { platform: "WINDOWS" as const }],
      ["c", { platform: "MACOS" as const }],
      ["d", { platform: null }],
      ["e", { platform: null }],
    ]);
    expect(findDuplicatePlatforms(files)).toEqual([
      { platform: "WINDOWS", fileIds: ["a", "b"] },
    ]);
  });

  it("is empty when every platform is used once", () => {
    expect(
      findDuplicatePlatforms(
        new Map([
          ["a", { platform: "WINDOWS" as const }],
          ["b", { platform: "MACOS" as const }],
        ]),
      ),
    ).toEqual([]);
  });
});

describe("release afterCursor", () => {
  it("selects rows strictly before the cursor (newest-first order)", () => {
    const createdAt = new Date("2026-10-19T00:00:00.000Z");
    expect(afterCursor({ createdAt, id: "b" })).toEqual({
      OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: "b" } }],
    });
  });
});

describe("releaseSearchWhere", () => {
  it("is empty without a query", () => {
    expect(releaseSearchWhere(undefined)).toEqual({});
    expect(releaseSearchWhere("  ")).toEqual({});
  });

  it("requires every term to match version, product or creator", () => {
    const where = releaseSearchWhere(" core  2.5 ") as {
      AND: { OR: unknown[] }[];
    };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0].OR).toContainEqual({
      product: { name: { contains: "core", mode: "insensitive" } },
    });
    expect(where.AND[1].OR).toContainEqual({
      version: { contains: "2.5", mode: "insensitive" },
    });
  });
});

describe("versionBelow", () => {
  it("matches lower majors, lower minors and lower patches", () => {
    expect(versionBelow({ major: 2, minor: 5, patch: 1 })).toEqual({
      OR: [
        { versionMajor: { lt: 2 } },
        { versionMajor: 2, versionMinor: { lt: 5 } },
        { versionMajor: 2, versionMinor: 5, versionPatch: { lt: 1 } },
      ],
    });
  });
});
