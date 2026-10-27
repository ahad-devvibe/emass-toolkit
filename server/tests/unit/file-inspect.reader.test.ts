import { describe, expect, it } from "vitest";
import {
  BLOCK_SIZE,
  BudgetExceeded,
  bufferReader,
  NeedBytes,
  OutOfBounds,
  READ_BUDGET,
  suppliedReader,
} from "../../src/services/releases/file-inspect/range-reader.js";

const bytes = Uint8Array.from(
  { length: BLOCK_SIZE * 3 + 100 },
  (_, i) => i % 251,
);

describe("bufferReader", () => {
  it("reads across block boundaries", async () => {
    const reader = bufferReader(bytes);
    const read = await reader.read(BLOCK_SIZE - 10, 20);
    expect(read).toEqual(bytes.subarray(BLOCK_SIZE - 10, BLOCK_SIZE + 10));
    expect(await reader.read(bytes.length - 5, 5)).toEqual(bytes.subarray(-5));
  });

  it("refuses reads outside the file", async () => {
    const reader = bufferReader(bytes);
    await expect(reader.read(bytes.length - 5, 6)).rejects.toBeInstanceOf(
      OutOfBounds,
    );
    await expect(reader.read(-1, 2)).rejects.toBeInstanceOf(OutOfBounds);
  });

  it("stops past the read budget", async () => {
    const big = new Uint8Array(READ_BUDGET + BLOCK_SIZE);
    const reader = bufferReader(big);
    await reader.read(0, READ_BUDGET);
    await expect(reader.read(READ_BUDGET, 1)).rejects.toBeInstanceOf(
      BudgetExceeded,
    );
  });
});

describe("suppliedReader", () => {
  it("asks for the missing block-aligned ranges, then reads them", async () => {
    const empty = suppliedReader(bytes.length, []);
    const need = await empty
      .read(BLOCK_SIZE + 5, BLOCK_SIZE)
      .catch((error) => error);
    expect(need).toBeInstanceOf(NeedBytes);
    expect((need as NeedBytes).ranges).toEqual([
      { offset: BLOCK_SIZE, length: 2 * BLOCK_SIZE },
    ]);

    const full = suppliedReader(bytes.length, [
      { offset: BLOCK_SIZE, data: bytes.subarray(BLOCK_SIZE, 3 * BLOCK_SIZE) },
    ]);
    expect(await full.read(BLOCK_SIZE + 5, BLOCK_SIZE)).toEqual(
      bytes.subarray(BLOCK_SIZE + 5, 2 * BLOCK_SIZE + 5),
    );
  });

  it("clips the last range to the file's end", async () => {
    const need = await suppliedReader(bytes.length, [])
      .read(bytes.length - 1, 1)
      .catch((error) => error);
    expect((need as NeedBytes).ranges).toEqual([
      { offset: 3 * BLOCK_SIZE, length: 100 },
    ]);
  });
});
