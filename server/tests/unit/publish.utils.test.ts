import { afterEach, describe, expect, it, vi } from "vitest";
import { weightedPercent } from "../../src/services/releases/publish.service.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("weightedPercent", () => {
  it("weighs progress by file size", () => {
    // 100 B done, then half of the 300 B file: 250 of 400
    expect(weightedPercent([100, 300], 1, 50)).toBe(62);
    expect(weightedPercent([100, 300], 0, 0)).toBe(0);
    expect(weightedPercent([100, 300], 2, 0)).toBe(100);
  });

  it("counts files when every file is empty", () => {
    expect(weightedPercent([0, 0], 1, 0)).toBe(50);
    expect(weightedPercent([0, 0], 1, 50)).toBe(75);
  });

  it("clamps progress and handles no files", () => {
    expect(weightedPercent([100], 0, 150)).toBe(100);
    expect(weightedPercent([100], 0, -5)).toBe(0);
    expect(weightedPercent([], 0, 0)).toBe(100);
  });
});
