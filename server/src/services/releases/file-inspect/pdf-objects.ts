import { latin1, latin1Bytes } from "./bytes.js";
import { inflateLenient } from "./decompress.js";
import { OutOfBounds, type RangeReader } from "./range-reader.js";

/** The structure can't be followed (a bad pointer or table); scan instead. */
export class Unfollowable extends Error {}

/** Where an object lives: at a byte offset, or packed in an object stream. */
type XrefEntry =
  | { kind: "offset"; offset: number }
  | { kind: "packed"; stream: number; index: number };

/** Reads grow from one block; objects and xref tables rarely need more. */
const FIRST_WINDOW = 64 * 1024;
const MAX_WINDOW = 4 * 1024 * 1024;
/** Guards against xref chains that loop or never end. */
const MAX_SECTIONS = 64;

/** The `<< ... >>` starting at `from`, nested dictionaries included. */
export function dictAt(text: string, from: number): string | null {
  const start = text.indexOf("<<", from);
  if (start === -1) return null;
  let depth = 0;
  for (let at = start; at < text.length - 1; at++) {
    if (text[at] === "<" && text[at + 1] === "<") {
      depth++;
      at++;
    } else if (text[at] === ">" && text[at + 1] === ">") {
      depth--;
      at++;
      if (depth === 0) return text.slice(start, at + 1);
    }
  }
  return null;
}

const refIn = (dict: string, key: string) => {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(dict);
  return match ? Number(match[1]) : null;
};

const numberIn = (dict: string, key: string) => {
  const match = new RegExp(`/${key}\\s+(\\d+)(?![\\d\\s]*\\s+R)`).exec(dict);
  return match ? Number(match[1]) : null;
};

const arrayIn = (dict: string, key: string) => {
  const match = new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`).exec(dict);
  return match
    ? match[1].trim().split(/\s+/).filter(Boolean).map(Number)
    : null;
};

/**
 * Undoes a PNG predictor (Predictor >= 10), which xref streams use: each row
 * is a filter byte, then `columns` bytes predicted from the row above.
 */
function unpredict(data: Uint8Array, columns: number): Uint8Array {
  const rowLength = columns + 1;
  const rows = Math.floor(data.length / rowLength);
  const out = new Uint8Array(rows * columns);
  for (let row = 0; row < rows; row++) {
    const filter = data[row * rowLength];
    for (let col = 0; col < columns; col++) {
      const raw = data[row * rowLength + 1 + col];
      const left = col > 0 ? out[row * columns + col - 1] : 0;
      const up = row > 0 ? out[(row - 1) * columns + col] : 0;
      const upLeft =
        row > 0 && col > 0 ? out[(row - 1) * columns + col - 1] : 0;
      let value = raw;
      if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [
          Math.abs(p - left),
          Math.abs(p - up),
          Math.abs(p - upLeft),
        ];
        value = raw + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      out[row * columns + col] = value & 0xff;
    }
  }
  return out;
}

/**
 * Follows a PDF's own pointers: `startxref` → cross-reference sections
 * (classic tables or xref streams, chained by /Prev and /XRefStm) → objects,
 * inflating object streams. Reads only what the pointers name, so the cost
 * doesn't grow with the PDF's size.
 */
export class PdfObjects {
  private entries = new Map<number, XrefEntry>();
  private objects = new Map<number, string>();
  /** The newest trailer's /Info and /Root object numbers. */
  info: number | null = null;
  root: number | null = null;

  private constructor(private reader: RangeReader) {}

  static async open(reader: RangeReader, startxref: number) {
    const pdf = new PdfObjects(reader);
    await pdf.readSections(startxref);
    return pdf;
  }

  /** Text from `offset` until `marker` appears (growing the read), as latin1. */
  private async textUntil(offset: number, marker: string): Promise<string> {
    let length = FIRST_WINDOW;
    for (;;) {
      const end = Math.min(offset + length, this.reader.size);
      if (offset >= end) throw new Unfollowable("Pointer past the end");
      const text = latin1(await this.reader.read(offset, end - offset));
      if (text.includes(marker) || end === this.reader.size) return text;
      if (length >= MAX_WINDOW) throw new Unfollowable(`No ${marker}`);
      length *= 2;
    }
  }

  private async readSections(first: number) {
    const pending = [first];
    const seen = new Set<number>();
    while (pending.length > 0) {
      const offset = pending.shift()!;
      if (seen.has(offset)) continue;
      if (seen.size >= MAX_SECTIONS) throw new Unfollowable("Xref loop");
      seen.add(offset);

      const head = latin1(
        await this.reader.read(offset, Math.min(16, this.reader.size - offset)),
      );
      const trailer = head.startsWith("xref")
        ? await this.readTable(offset)
        : await this.readXrefStream(offset);

      this.info ??= refIn(trailer, "Info");
      this.root ??= refIn(trailer, "Root");
      // A hybrid file's /XRefStm holds the entries the table leaves out;
      // both come before the older revision in /Prev
      const stream = numberIn(trailer, "XRefStm");
      const prev = numberIn(trailer, "Prev");
      if (stream !== null) pending.unshift(stream);
      if (prev !== null) pending.push(prev);
    }
  }

  private set(num: number, entry: XrefEntry) {
    // Sections are read newest first, so the first entry for a number wins
    if (!this.entries.has(num)) this.entries.set(num, entry);
  }

  /** A classic `xref` table; returns its trailer dictionary. */
  private async readTable(offset: number): Promise<string> {
    const text = await this.textUntil(offset, "trailer");
    const trailerAt = text.indexOf("trailer");
    if (trailerAt === -1) throw new Unfollowable("No trailer");
    const body = text.slice(4, trailerAt);
    const section = /(\d+)\s+(\d+)\s*[\r\n]/g;
    const entry = /(\d{10})\s(\d{5})\s([nf])/y;
    let at = 0;
    for (;;) {
      section.lastIndex = at;
      const header = section.exec(body);
      if (!header) break;
      const [start, count] = [Number(header[1]), Number(header[2])];
      at = section.lastIndex;
      for (let i = 0; i < count; i++) {
        while (/\s/.test(body[at] ?? "")) at++;
        entry.lastIndex = at;
        const row = entry.exec(body);
        if (!row) throw new Unfollowable("Bad xref row");
        at = entry.lastIndex;
        if (row[3] === "n") {
          this.set(start + i, { kind: "offset", offset: Number(row[1]) });
        }
      }
    }
    const trailer = dictAt(text, trailerAt);
    if (!trailer) throw new Unfollowable("Bad trailer");
    return trailer;
  }

  /** A cross-reference stream (PDF 1.5+); its dictionary is the trailer. */
  private async readXrefStream(offset: number): Promise<string> {
    const text = await this.textUntil(offset, "endstream");
    const { dict, data } = streamParts(text);
    if (!/\/Type\s*\/XRef/.test(dict)) throw new Unfollowable("Not an xref");
    const widths = arrayIn(dict, "W");
    const size = numberIn(dict, "Size");
    if (!widths || widths.length !== 3 || size === null) {
      throw new Unfollowable("Bad xref stream");
    }
    const rowWidth = widths[0] + widths[1] + widths[2];
    const columns = numberIn(dict, "Columns");
    const predictor = numberIn(dict, "Predictor") ?? 1;
    const rows = predictor >= 10 ? unpredict(data, columns ?? rowWidth) : data;
    const index = arrayIn(dict, "Index") ?? [0, size];

    const field = (row: number, from: number, width: number) => {
      let value = 0;
      for (let i = 0; i < width; i++) {
        value = value * 256 + rows[row * rowWidth + from + i];
      }
      return value;
    };
    let row = 0;
    for (let i = 0; i + 1 < index.length; i += 2) {
      for (let n = 0; n < index[i + 1]; n++, row++) {
        if ((row + 1) * rowWidth > rows.length) {
          throw new Unfollowable("Short xref stream");
        }
        const type = widths[0] === 0 ? 1 : field(row, 0, widths[0]);
        const second = field(row, widths[0], widths[1]);
        const third = field(row, widths[0] + widths[1], widths[2]);
        if (type === 1)
          this.set(index[i] + n, { kind: "offset", offset: second });
        if (type === 2) {
          this.set(index[i] + n, {
            kind: "packed",
            stream: second,
            index: third,
          });
        }
      }
    }
    return dict;
  }

  /** An object's text after `N G obj` (its dictionary, value or stream). */
  async object(num: number, depth = 0): Promise<string | null> {
    if (this.objects.has(num)) return this.objects.get(num)!;
    const entry = this.entries.get(num);
    if (!entry || depth > 1) return null;

    let body: string;
    if (entry.kind === "offset") {
      const text = await this.textUntil(entry.offset, "endobj");
      const header = /^\s*(\d+)\s+\d+\s+obj\b/.exec(text);
      if (!header || Number(header[1]) !== num) {
        throw new Unfollowable(`Object ${num} isn't where the xref says`);
      }
      const end = text.indexOf("endobj");
      body = text.slice(header[0].length, end === -1 ? undefined : end);
    } else {
      const container = await this.object(entry.stream, depth + 1);
      if (!container) return null;
      const { dict, data } = streamParts(container);
      const first = numberIn(dict, "First");
      if (first === null) throw new Unfollowable("Bad object stream");
      const content = latin1(data);
      const pairs = content.slice(0, first).trim().split(/\s+/).map(Number);
      const at = pairs[entry.index * 2 + 1];
      if (at === undefined) throw new Unfollowable("Bad object stream index");
      const next = pairs[entry.index * 2 + 3];
      body = content.slice(
        first + at,
        next === undefined ? undefined : first + next,
      );
    }
    this.objects.set(num, body);
    return body;
  }
}

/**
 * A stream object's dictionary and decoded data (FlateDecode with an optional
 * PNG predictor, or unfiltered). Other filters carry nothing we read.
 */
export function streamParts(text: string): { dict: string; data: Uint8Array } {
  const streamAt = text.indexOf("stream");
  const dict = streamAt === -1 ? null : dictAt(text.slice(0, streamAt), 0);
  if (!dict) throw new Unfollowable("Not a stream");
  const dataStart = streamAt + (text.startsWith("\r\n", streamAt + 6) ? 8 : 7);
  const declared = numberIn(dict, "Length");
  const endAt = text.indexOf("endstream", dataStart);
  const dataEnd =
    declared !== null && dataStart + declared <= text.length
      ? dataStart + declared
      : endAt;
  if (dataEnd === -1) throw new Unfollowable("Unterminated stream");
  const raw = latin1Bytes(text.slice(dataStart, dataEnd));

  if (!/\/Filter/.test(dict)) return { dict, data: raw };
  if (!/\/FlateDecode/.test(dict)) throw new Unfollowable("Unsupported filter");
  let data: Uint8Array;
  try {
    data = inflateLenient(raw);
  } catch {
    throw new Unfollowable("Stream won't inflate");
  }
  return { dict, data };
}

/** Out-of-range pointers mean the structure can't be followed, not damage. */
export function followable<T>(work: () => Promise<T>): Promise<T> {
  return work().catch((error) => {
    if (error instanceof OutOfBounds) throw new Unfollowable(error.message);
    throw error;
  });
}
