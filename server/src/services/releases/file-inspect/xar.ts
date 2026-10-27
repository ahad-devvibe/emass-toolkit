import { u16be, u64be, utf8 } from "./bytes.js";
import { inflate, MAX_DECOMPRESSED } from "./decompress.js";
import { BudgetExceeded, Damaged, type RangeReader } from "./range-reader.js";
import type { FoundVersion } from "./types.js";
import { normalizeVersion } from "./versions.js";

const invalid = (why: string) => new Damaged(`Not a valid .pkg: ${why}.`);

interface XarFile {
  path: string;
  offset: number | null;
  length: number;
  encoding: string;
}

/**
 * The package's own version from a macOS installer (a xar archive). The table
 * of contents at the start lists every file's offset in the heap, so
 * `Distribution` and each `PackageInfo` are read wherever they sit (productbuild
 * puts them at the end). Bundled frameworks' versions (`<bundle>`) are ignored.
 */
export async function pkgVersions(
  reader: RangeReader,
): Promise<FoundVersion[]> {
  if (reader.size < 28) throw invalid("the file is too short");
  const header = await reader.read(0, 28);
  const headerSize = u16be(header, 4);
  const tocLength = u64be(header, 8);
  if (headerSize < 28 || tocLength === null || tocLength === 0) {
    throw invalid("the archive header is broken");
  }
  if (headerSize + tocLength > reader.size) {
    throw invalid("the table of contents runs past the end of the file");
  }
  if (tocLength > MAX_DECOMPRESSED)
    throw new BudgetExceeded("Table of contents too large");

  let toc: string;
  try {
    toc = utf8(inflate(await reader.read(headerSize, tocLength)));
  } catch (error) {
    if (error instanceof BudgetExceeded) throw error;
    throw invalid("the table of contents can't be decompressed");
  }
  const heap = headerSize + tocLength;

  const found: FoundVersion[] = [];
  for (const file of tocFiles(toc)) {
    const parts = file.path.split("/");
    const isDistribution = file.path === "Distribution";
    // At the root (component package) or one level down (product archive)
    const isPackageInfo = parts.at(-1) === "PackageInfo" && parts.length <= 2;
    if (!isDistribution && !isPackageInfo) continue;
    if (
      file.offset === null ||
      heap + file.offset + file.length > reader.size
    ) {
      throw invalid(`${file.path} points past the end of the file`);
    }
    if (file.length > MAX_DECOMPRESSED) continue;

    const stored = await reader.read(heap + file.offset, file.length);
    let xml: string;
    if (file.encoding === "application/octet-stream") {
      xml = utf8(stored);
    } else if (file.encoding === "application/x-gzip") {
      try {
        xml = utf8(inflate(stored));
      } catch (error) {
        if (error instanceof BudgetExceeded) throw error;
        throw invalid(`${file.path} can't be decompressed`);
      }
    } else {
      continue; // bzip2 and others: rare, and nothing to say they're broken
    }

    if (isPackageInfo) {
      const root = /<pkg-info\b[^>]*>/.exec(xml);
      add(found, "pkg-info version", root && versionAttribute(root[0]));
    } else {
      for (const tag of xml.match(/<(?:pkg-ref|product)\b[^>]*>/g) ?? []) {
        const element = tag.startsWith("<product") ? "product" : "pkg-ref";
        add(found, `${element} version`, versionAttribute(tag));
      }
    }
  }
  return found;
}

function add(found: FoundVersion[], field: string, raw: string | null) {
  const version = raw && normalizeVersion(raw);
  if (raw && version) found.push({ source: "pkg", field, raw, version });
}

function versionAttribute(tag: string): string | null {
  const match = /\sversion\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

/**
 * The files a xar table of contents lists, with their heap location. A tiny
 * tag walker: only `<file>`, its `<name>` and its `<data>` fields matter, and
 * the `<ea>` (extended attribute) entries that also carry them are skipped.
 */
function tocFiles(toc: string): XarFile[] {
  if (!toc.includes("<xar")) throw invalid("the table of contents isn't XML");
  const files: XarFile[] = [];
  const stack: string[] = [];
  const open: { names: string[]; file: XarFile }[] = [];

  for (const match of toc.matchAll(/<(\/?)([\w:-]+)[^>]*?(\/?)>|([^<]+)/g)) {
    const [, closing, tag, selfClosing, text] = match;
    if (text !== undefined) {
      const value = text.trim();
      const parent = stack.at(-1);
      const grandparent = stack.at(-2);
      const current = open.at(-1);
      if (!current || !value) continue;
      if (parent === "name" && grandparent === "file")
        current.names.push(value);
      if (grandparent === "data" && stack.at(-3) === "file") {
        if (parent === "offset") current.file.offset = Number(value);
        if (parent === "length") current.file.length = Number(value);
      }
      continue;
    }
    if (closing) {
      stack.pop();
      if (tag === "file") {
        const done = open.pop()!;
        done.file.path = [...open.map((o) => o.names[0]), done.names[0]].join(
          "/",
        );
        files.push(done.file);
      }
      continue;
    }
    if (
      tag === "encoding" &&
      stack.at(-1) === "data" &&
      stack.at(-2) === "file"
    ) {
      const style = /style\s*=\s*"([^"]*)"/.exec(match[0]);
      if (style) open.at(-1)!.file.encoding = style[1];
    }
    if (selfClosing || match[0].endsWith("/>")) continue;
    stack.push(tag);
    if (tag === "file") {
      open.push({
        names: [],
        file: { path: "", offset: null, length: 0, encoding: "" },
      });
    }
  }
  return files;
}
