import { createHash } from "node:crypto";
import { createSHA256 } from "hash-wasm";
import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  expectedPartLength,
  isStale,
  nextPart,
  partCount,
  partsToCommit,
} from "../../src/services/releases/upload-sessions.utils.js";

describe("partCount", () => {
  it("rounds up to whole parts", () => {
    expect(partCount(10, 4)).toBe(3);
    expect(partCount(8, 4)).toBe(2);
    expect(partCount(1, 4)).toBe(1);
  });

  it("gives an empty file one part", () => {
    expect(partCount(0, 4)).toBe(1);
  });
});

describe("expectedPartLength", () => {
  it("is the part size except for the last part", () => {
    expect([1, 2, 3].map((n) => expectedPartLength(10, 4, n))).toEqual([
      4, 4, 2,
    ]);
    expect(expectedPartLength(8, 4, 2)).toBe(4);
  });

  it("is -1 for part numbers outside the file", () => {
    expect(expectedPartLength(10, 4, 0)).toBe(-1);
    expect(expectedPartLength(10, 4, 4)).toBe(-1);
  });
});

describe("nextPart", () => {
  it("stores the next part, acknowledges stored ones and refuses gaps", () => {
    expect(nextPart(2, 3)).toBe("store");
    expect(nextPart(2, 2)).toBe("stored");
    expect(nextPart(2, 1)).toBe("stored");
    expect(nextPart(2, 4)).toBe("gap");
  });
});

describe("isStale", () => {
  const now = new Date("2026-10-28T12:00:00.000Z");

  it("is stale only after 24 hours untouched", () => {
    const at = (msAgo: number) => new Date(now.getTime() - msAgo);
    expect(isStale(at(SESSION_TTL_MS), now)).toBe(false);
    expect(isStale(at(SESSION_TTL_MS + 1), now)).toBe(true);
  });
});

describe("partsToCommit", () => {
  // A 10-byte file in 4-byte parts: 4, 4, 2
  const listed = [
    { partNum: 2, etag: "s2", md5: "m2", size: 4 },
    { partNum: 1, etag: "s1", md5: "m1", size: 4 },
    { partNum: 3, etag: "s3", md5: "m3", size: 2 },
  ];

  it("commits storage's etags in order, whatever the session recorded", () => {
    const recorded = {
      "1": { etag: "old", md5: "m1" },
      "2": "b",
      "3": { etag: "c", md5: "m3" },
    };
    expect(partsToCommit(listed, recorded, 10, 4)).toEqual({
      ok: true,
      parts: [
        { partNum: 1, etag: "s1" },
        { partNum: 2, etag: "s2" },
        { partNum: 3, etag: "s3" },
      ],
    });
  });

  it("refuses a missing part, a wrong size or other bytes", () => {
    expect(partsToCommit(listed.slice(0, 2), {}, 10, 4)).toEqual({
      ok: false,
      partNum: 3,
    });
    expect(
      partsToCommit(
        [...listed.slice(0, 2), { partNum: 3, etag: "s3", md5: "m3", size: 3 }],
        {},
        10,
        4,
      ),
    ).toEqual({ ok: false, partNum: 3 });
    expect(
      partsToCommit(listed, { "2": { etag: "b", md5: "other" } }, 10, 4),
    ).toEqual({ ok: false, partNum: 2 });
  });
});

describe("hash state across parts", () => {
  it("saving and loading between parts gives the one-shot SHA-256", async () => {
    const data = Buffer.from("resumable uploads hash part by part".repeat(50));
    const parts = [
      data.subarray(0, 700),
      data.subarray(700, 1400),
      data.subarray(1400),
    ];

    const first = await createSHA256();
    first.init();
    let state = first.save();
    for (const part of parts) {
      // A fresh hasher per part, as after a server restart
      const hasher = await createSHA256();
      hasher.load(state);
      hasher.update(part);
      state = hasher.save();
    }
    const last = await createSHA256();
    last.load(state);

    expect(last.digest("hex")).toBe(
      createHash("sha256").update(data).digest("hex"),
    );
  });
});
