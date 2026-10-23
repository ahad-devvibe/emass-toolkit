import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../../src/utils/cursor.utils.js";

describe("keyset cursor", () => {
  it("round-trips createdAt and id", () => {
    const cursor = {
      createdAt: new Date("2026-10-19T08:30:00.123Z"),
      id: "0e21dd0e-5bef-4048-9816-4133492f9679",
    };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects garbage and malformed dates", () => {
    for (const raw of [
      "garbage",
      Buffer.from("not-a-date|abc").toString("base64url"),
      Buffer.from("2026-10-19T08:30:00.000Z|").toString("base64url"),
    ]) {
      expect(() => decodeCursor(raw)).toThrowError(
        expect.objectContaining({ code: "INVALID_CURSOR" }),
      );
    }
  });
});
