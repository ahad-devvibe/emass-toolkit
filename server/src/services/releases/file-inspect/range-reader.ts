/** Reads are fetched and cached in aligned blocks of this size. */
export const BLOCK_SIZE = 64 * 1024;
/**
 * The most bytes one inspection may read, so no file can make us read it all.
 * A browser sends them base64 in one JSON body: 7 MB is ~9.4 MB, under the
 * 10 MB express.json limit. The post-upload re-check uses the same budget, so
 * both always reach the same verdict.
 */
export const READ_BUDGET = 7 * 1024 * 1024;

export interface ByteRange {
  offset: number;
  length: number;
}

/** Random access to a file's bytes, wherever they live (a request, disk, OCI). */
export interface RangeReader {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** The parse needs these block-aligned ranges, which the caller doesn't have yet. */
export class NeedBytes extends Error {
  constructor(readonly ranges: ByteRange[]) {
    super("More bytes are needed");
  }
}

/** A read past either end of the file: a pointer in its structure is wrong. */
export class OutOfBounds extends Error {}

/** Reading on would exceed READ_BUDGET. */
export class BudgetExceeded extends Error {}

/** The file breaks its own format's rules; `message` is shown to the developer. */
export class Damaged extends Error {}

/** Loads whole ranges; may throw NeedBytes instead of loading them. */
export type RangeLoader = (ranges: ByteRange[]) => Promise<Uint8Array[]>;

/**
 * A RangeReader that fetches whole blocks through `load`, caches them, and
 * enforces READ_BUDGET. Missing blocks of one read are loaded together.
 */
export function blockReader(size: number, load: RangeLoader): RangeReader {
  const blocks = new Map<number, Uint8Array>();
  let loaded = 0;

  return {
    size,
    async read(offset, length) {
      if (
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(length) ||
        offset < 0 ||
        length < 0 ||
        offset + length > size
      ) {
        throw new OutOfBounds(`Read ${offset}+${length} outside ${size} bytes`);
      }
      if (length === 0) return new Uint8Array(0);

      const first = Math.floor(offset / BLOCK_SIZE);
      const last = Math.floor((offset + length - 1) / BLOCK_SIZE);
      const missing: ByteRange[] = [];
      for (let index = first; index <= last; index++) {
        if (blocks.has(index)) continue;
        const start = index * BLOCK_SIZE;
        const end = Math.min(start + BLOCK_SIZE, size);
        const previous = missing.at(-1);
        if (previous && previous.offset + previous.length === start) {
          previous.length = end - previous.offset;
        } else {
          missing.push({ offset: start, length: end - start });
        }
      }

      if (missing.length > 0) {
        const wanted = missing.reduce((sum, range) => sum + range.length, 0);
        if (loaded + wanted > READ_BUDGET) {
          throw new BudgetExceeded(`Reading ${wanted} more bytes`);
        }
        const chunks = await load(missing);
        missing.forEach((range, i) => {
          const chunk = chunks[i];
          if (chunk.length !== range.length) {
            throw new OutOfBounds(`Loaded ${chunk.length} of ${range.length}`);
          }
          for (let at = 0; at < range.length; at += BLOCK_SIZE) {
            blocks.set(
              (range.offset + at) / BLOCK_SIZE,
              chunk.subarray(at, Math.min(at + BLOCK_SIZE, range.length)),
            );
          }
        });
        loaded += wanted;
      }

      const out = new Uint8Array(length);
      for (let index = first; index <= last; index++) {
        const block = blocks.get(index)!;
        const blockStart = index * BLOCK_SIZE;
        const from = Math.max(offset, blockStart) - blockStart;
        const to =
          Math.min(offset + length, blockStart + block.length) - blockStart;
        out.set(block.subarray(from, to), blockStart + from - offset);
      }
      return out;
    },
  };
}

/** A reader over bytes already in memory (tests, small files). */
export function bufferReader(bytes: Uint8Array): RangeReader {
  return blockReader(bytes.length, async (ranges) =>
    ranges.map(({ offset, length }) => bytes.subarray(offset, offset + length)),
  );
}

/**
 * A reader over the ranges a client already sent. Anything else makes the
 * parse stop with NeedBytes, listing the block-aligned ranges to send next.
 */
export function suppliedReader(
  size: number,
  supplied: { offset: number; data: Uint8Array }[],
): RangeReader {
  const have = new Map<number, Uint8Array>();
  for (const { offset, data } of supplied) {
    for (let at = 0; at < data.length; at += BLOCK_SIZE) {
      have.set(offset + at, data.subarray(at, at + BLOCK_SIZE));
    }
  }
  return blockReader(size, async (ranges) => {
    const chunks: Uint8Array[] = [];
    const absent: ByteRange[] = [];
    for (const range of ranges) {
      const parts: Uint8Array[] = [];
      for (let at = 0; at < range.length; at += BLOCK_SIZE) {
        const block = have.get(range.offset + at);
        if (block) parts.push(block);
      }
      const total = parts.reduce((sum, part) => sum + part.length, 0);
      if (total !== range.length) {
        absent.push(range);
        continue;
      }
      const chunk = new Uint8Array(total);
      let at = 0;
      for (const part of parts) {
        chunk.set(part, at);
        at += part.length;
      }
      chunks.push(chunk);
    }
    if (absent.length > 0) throw new NeedBytes(absent);
    return chunks;
  });
}
