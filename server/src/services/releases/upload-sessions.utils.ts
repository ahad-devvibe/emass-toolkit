/** Untouched for this long, a session is aborted the next time its release's uploads are read. */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** How many parts a file of `size` bytes takes; even an empty file sends one. */
export function partCount(size: number, partSize: number): number {
  return Math.max(1, Math.ceil(size / partSize));
}

/** Part `n` (1-based) is `partSize` bytes, except the last, which is what remains. */
export function expectedPartLength(
  size: number,
  partSize: number,
  n: number,
): number {
  const last = partCount(size, partSize);
  if (n < 1 || n > last) return -1;
  return n < last ? partSize : size - (last - 1) * partSize;
}

/**
 * What to do with part `n` when `partsDone` parts are stored: store it (the
 * next one), acknowledge it (already stored; a retry after a lost response),
 * or refuse it (a gap).
 */
export function nextPart(
  partsDone: number,
  n: number,
): "store" | "stored" | "gap" {
  if (n === partsDone + 1) return "store";
  return n <= partsDone ? "stored" : "gap";
}

export function isStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() > SESSION_TTL_MS;
}

/** What a session remembers per part: its etag and, since this was added, its MD5. */
export type RecordedPart = string | { etag: string; md5: string };

export interface ListedPart {
  partNum: number;
  etag: string;
  md5: string;
  size: number;
}

/**
 * The parts to commit, taken from what storage holds now: parts 1..count, each
 * the expected size and, where the session recorded it, the same MD5 as the
 * bytes the server hashed. A part sent twice keeps storage's latest etag,
 * which is the one a commit needs. Returns the first part that doesn't fit.
 */
export function partsToCommit(
  listed: ListedPart[],
  recorded: Record<string, RecordedPart>,
  size: number,
  partSize: number,
):
  | { ok: true; parts: { partNum: number; etag: string }[] }
  | { ok: false; partNum: number } {
  const byNumber = new Map(listed.map((part) => [part.partNum, part]));
  const parts: { partNum: number; etag: string }[] = [];
  for (let partNum = 1; partNum <= partCount(size, partSize); partNum++) {
    const part = byNumber.get(partNum);
    const mine = recorded[String(partNum)];
    const md5 = typeof mine === "object" ? mine.md5 : undefined;
    if (
      !part ||
      part.size !== expectedPartLength(size, partSize, partNum) ||
      (md5 !== undefined && part.md5 !== md5)
    ) {
      return { ok: false, partNum };
    }
    parts.push({ partNum, etag: part.etag });
  }
  return { ok: true, parts };
}
