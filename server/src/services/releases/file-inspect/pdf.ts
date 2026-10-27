import { latin1, latin1Bytes, utf16be } from "./bytes.js";
import { inflateLenient } from "./decompress.js";
import {
  followable,
  PdfObjects,
  streamParts,
  Unfollowable,
} from "./pdf-objects.js";
import { Damaged, type RangeReader } from "./range-reader.js";
import type { FoundVersion } from "./types.js";
import { versionsInText } from "./versions.js";

/** PDFs up to this size are read whole; larger ones only at both ends. */
const WHOLE_LIMIT = 5 * 1024 * 1024;
const EDGE = 1024 * 1024;
/** The spec puts %%EOF in the last 1 KB; allow for trailing junk. */
const EOF_WINDOW = 4096;

/** What the PDF says about itself: Info strings and XMP packets. */
interface PdfMetadata {
  info: string[];
  xmp: string[];
}

/**
 * Versions in a PDF's document properties: the Info dictionary's Title and
 * Subject, and the XMP title and description. The PDF's own pointers are
 * followed (startxref → xref → Info and Root → Metadata), so the bytes read
 * don't grow with its size. If a pointer is broken, the file is scanned
 * instead: whole up to 5 MB, else both ends.
 */
export async function pdfVersions(
  reader: RangeReader,
): Promise<FoundVersion[]> {
  const tailLength = Math.min(EOF_WINDOW, reader.size);
  const tail = latin1(await reader.read(reader.size - tailLength, tailLength));
  if (!tail.includes("%%EOF")) {
    throw new Damaged(
      "Not a valid PDF: the file is cut short (no end-of-file marker).",
    );
  }

  let metadata: PdfMetadata;
  try {
    metadata = await followable(() => followPointers(reader, tail));
  } catch (error) {
    if (!(error instanceof Unfollowable)) throw error;
    metadata = await scan(reader);
  }

  const found: FoundVersion[] = [];
  const add = (field: string, raw: string) => {
    for (const version of versionsInText(raw)) {
      found.push({ source: "pdf", field, raw: raw.trim(), version });
    }
  };
  for (const dict of metadata.info) {
    for (const key of ["Title", "Subject"]) {
      const value = dictString(dict, key);
      if (value) add(`Info ${key}`, value);
    }
  }
  for (const packet of metadata.xmp) {
    for (const [tag, field] of [
      ["dc:title", "XMP title"],
      ["dc:description", "XMP description"],
    ]) {
      const element = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(packet);
      if (element) add(field, xmlText(element[1]));
    }
  }
  return found;
}

const xmpPackets = (text: string) =>
  text.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/g) ?? [];

async function followPointers(
  reader: RangeReader,
  tail: string,
): Promise<PdfMetadata> {
  const startxref = [...tail.matchAll(/startxref\s+(\d+)/g)].at(-1);
  if (!startxref) throw new Unfollowable("No startxref");
  const pdf = await PdfObjects.open(reader, Number(startxref[1]));

  const info = pdf.info === null ? null : await pdf.object(pdf.info);
  const root = pdf.root === null ? null : await pdf.object(pdf.root);
  const metadataRef = root && /\/Metadata\s+(\d+)\s+\d+\s+R/.exec(root);
  const metadata = metadataRef
    ? await pdf.object(Number(metadataRef[1]))
    : null;
  return {
    info: info ? [info] : [],
    xmp: metadata ? xmpPackets(latin1(streamParts(metadata).data)) : [],
  };
}

/** The fallback: search the bytes for Info dictionaries and XMP packets. */
async function scan(reader: RangeReader): Promise<PdfMetadata> {
  const parts =
    reader.size <= WHOLE_LIMIT
      ? [await reader.read(0, reader.size)]
      : [
          await reader.read(0, EDGE),
          await reader.read(reader.size - EDGE, EDGE),
        ];
  const metadata: PdfMetadata = { info: [], xmp: [] };
  for (const part of parts) {
    const text = latin1(part);
    const streams = decodedStreams(text);
    for (const ref of new Set(
      [...text.matchAll(/\/Info\s+(\d+)\s+\d+\s+R/g)].map((m) => Number(m[1])),
    )) {
      const dict =
        objectText(text, ref) ?? packedObject(streams.objectStreams, ref);
      if (dict) metadata.info.push(dict);
    }
    metadata.xmp.push(...[text, ...streams.metadata].flatMap(xmpPackets));
  }
  return metadata;
}

/** An uncompressed object's text, `N 0 obj ... endobj`. */
function objectText(text: string, num: number): string | null {
  const start = new RegExp(`(?<!\\d)${num}\\s+\\d+\\s+obj\\b`).exec(text);
  if (!start) return null;
  const end = text.indexOf("endobj", start.index);
  return text.slice(start.index, end === -1 ? undefined : end);
}

interface ObjectStream {
  first: number;
  content: string;
}

/** Inflated object streams (where newer PDFs pack Info) and metadata streams. */
function decodedStreams(text: string) {
  const objectStreams: ObjectStream[] = [];
  const metadata: string[] = [];
  for (const match of text.matchAll(/(?<!\d)\d+\s+\d+\s+obj\b/g)) {
    const streamAt = text.indexOf("stream", match.index);
    const endObj = text.indexOf("endobj", match.index);
    if (streamAt === -1 || (endObj !== -1 && endObj < streamAt)) continue;
    const dict = text.slice(match.index, streamAt);
    const isObjects = /\/Type\s*\/ObjStm/.test(dict);
    const isMetadata = /\/Type\s*\/Metadata/.test(dict);
    if ((!isObjects && !isMetadata) || !/\/FlateDecode/.test(dict)) continue;

    const dataStart =
      streamAt + (text.startsWith("\r\n", streamAt + 6) ? 8 : 7);
    const dataEnd = text.indexOf("endstream", dataStart);
    if (dataEnd === -1) continue;
    let content: string;
    try {
      content = latin1(
        inflateLenient(latin1Bytes(text.slice(dataStart, dataEnd))),
      );
    } catch {
      continue; // an unreadable stream just carries no versions
    }
    if (isMetadata) metadata.push(content);
    const first = /\/First\s+(\d+)/.exec(dict);
    if (isObjects && first)
      objectStreams.push({ first: Number(first[1]), content });
  }
  return { objectStreams, metadata };
}

/** An object's text from inside an object stream. */
function packedObject(streams: ObjectStream[], num: number): string | null {
  for (const { first, content } of streams) {
    const index = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i + 1 < index.length; i += 2) {
      if (index[i] !== num) continue;
      const start = first + index[i + 1];
      const end = i + 3 < index.length ? first + index[i + 3] : content.length;
      return content.slice(start, end);
    }
  }
  return null;
}

/** A string value from a PDF dictionary: literal `(...)` or hex `<...>`. */
export function dictString(dict: string, key: string): string | null {
  const match = new RegExp(`/${key}\\s*([(<])`).exec(dict);
  if (!match) return null;
  let at = match.index + match[0].length;
  const bytes: number[] = [];

  if (match[1] === "<") {
    const end = dict.indexOf(">", at);
    const hex = dict
      .slice(at, end === -1 ? undefined : end)
      .replace(/[^0-9a-f]/gi, "");
    for (let i = 0; i < hex.length; i += 2)
      bytes.push(parseInt(hex.slice(i, i + 2).padEnd(2, "0"), 16));
  } else {
    let depth = 1;
    while (at < dict.length) {
      const char = dict[at++];
      if (char === "\\") {
        const next = dict[at++];
        const escapes: Record<string, number> = {
          n: 10,
          r: 13,
          t: 9,
          b: 8,
          f: 12,
        };
        if (next in escapes) bytes.push(escapes[next]);
        else if (/[0-7]/.test(next)) {
          let octal = next;
          while (octal.length < 3 && /[0-7]/.test(dict[at]))
            octal += dict[at++];
          bytes.push(parseInt(octal, 8) & 0xff);
        } else if (next === "\r" || next === "\n") {
          if (next === "\r" && dict[at] === "\n") at++;
        } else bytes.push(next.charCodeAt(0));
        continue;
      }
      if (char === "(") depth++;
      if (char === ")" && --depth === 0) break;
      bytes.push(char.charCodeAt(0));
    }
  }

  const raw = Uint8Array.from(bytes);
  return raw[0] === 0xfe && raw[1] === 0xff
    ? utf16be(raw.subarray(2))
    : latin1(raw);
}

function xmlText(xml: string): string {
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
