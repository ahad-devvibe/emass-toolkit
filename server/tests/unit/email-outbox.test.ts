import { describe, expect, it } from "vitest";
import {
  backoffMs,
  LEASE_MS,
} from "../../src/services/email/email-outbox.service.js";
import { isRetryableStatus } from "../../src/services/email/email.utils.js";
import { claimSize, paceGapMs } from "../../src/services/email/email-worker.js";

describe("isRetryableStatus", () => {
  it("retries throttling, server errors and network failures only", () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(undefined)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe("backoffMs", () => {
  it("waits 1 min, 5 min, 30 min, then 2 h", () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([
      60_000, 300_000, 1_800_000, 7_200_000, 7_200_000,
    ]);
  });
});

describe("pacing", () => {
  it("spaces sends evenly across a minute", () => {
    expect(paceGapMs(10)).toBe(6000);
    expect(paceGapMs(120)).toBe(500);
  });

  it("claims no more than fit in 80% of the lease, the batch size or the cap", () => {
    // 10/min: 80% of a 5-minute lease fits 40, capped at 25 per claim
    expect(claimSize(paceGapMs(10), 1000)).toBe(25);
    // 1/min: 4 sends fit in 4 of the lease's 5 minutes
    expect(claimSize(paceGapMs(1), 1000)).toBe((0.8 * LEASE_MS) / 60_000);
    // Slower than the lease: still one at a time
    expect(claimSize(LEASE_MS * 2, 1000)).toBe(1);
    expect(claimSize(paceGapMs(60_000), 3)).toBe(3);
    expect(claimSize(paceGapMs(10), 0)).toBe(0);
    expect(claimSize(paceGapMs(10), -4)).toBe(0);
  });
});
