import { latin1, u16le, u32le, utf16le } from "./bytes.js";
import { Damaged, type RangeReader } from "./range-reader.js";
import type { FoundVersion } from "./types.js";
import { normalizeVersion } from "./versions.js";

const RT_VERSION = 16;
const VS_FIXEDFILEINFO_SIGNATURE = 0xfeef04bd;
/** Version resources are a few KB; a bigger one is not worth reading. */
const MAX_VERSION_RESOURCE = 64 * 1024;
const STRING_FIELDS = new Set(["FileVersion", "ProductVersion"]);

interface Section {
  virtualAddress: number;
  virtualSize: number;
  rawOffset: number;
  rawSize: number;
}

const invalid = (why: string) =>
  new Damaged(`Not a valid Windows executable: ${why}.`);

/**
 * Versions from a PE file's VERSIONINFO resource, the one Windows shows under
 * Properties → Details: the fixed FileVersion / ProductVersion numbers and
 * the matching strings. An executable without the resource yields none.
 */
export async function peVersions(reader: RangeReader): Promise<FoundVersion[]> {
  const dos = await reader.read(0, Math.min(64, reader.size));
  if (dos.length < 64) throw invalid("the file is too short");
  const peOffset = u32le(dos, 0x3c);
  if (peOffset + 24 > reader.size) {
    throw invalid("the PE header points past the end of the file");
  }

  const coff = await reader.read(peOffset, 24);
  if (latin1(coff.subarray(0, 4)) !== "PE\0\0") {
    throw invalid("the PE signature is missing");
  }
  const sectionCount = u16le(coff, 6);
  const optionalSize = u16le(coff, 20);
  const optionalOffset = peOffset + 24;
  if (optionalOffset + optionalSize + sectionCount * 40 > reader.size) {
    throw invalid("the section table runs past the end of the file");
  }

  const optional = await reader.read(optionalOffset, optionalSize);
  const magic = optionalSize >= 2 ? u16le(optional, 0) : 0;
  if (magic !== 0x10b && magic !== 0x20b) {
    throw invalid("the optional header is unrecognised");
  }
  const directories = magic === 0x10b ? 96 : 112;
  const directoryCount = u32le(optional, directories - 4);
  // No resource directory: nothing to read, but the file is fine
  if (directoryCount < 3 || directories + 24 > optionalSize) return [];
  const resourceRva = u32le(optional, directories + 16);
  if (resourceRva === 0) return [];

  const table = await reader.read(
    optionalOffset + optionalSize,
    sectionCount * 40,
  );
  const sections: Section[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const at = i * 40;
    sections.push({
      virtualSize: u32le(table, at + 8),
      virtualAddress: u32le(table, at + 12),
      rawSize: u32le(table, at + 16),
      rawOffset: u32le(table, at + 20),
    });
  }
  const toOffset = (rva: number) => {
    const section = sections.find(
      (s) =>
        rva >= s.virtualAddress &&
        rva < s.virtualAddress + Math.max(s.virtualSize, s.rawSize),
    );
    if (!section) throw invalid("the resource table isn't in any section");
    return section.rawOffset + (rva - section.virtualAddress);
  };
  const resourceBase = toOffset(resourceRva);

  /** The entries of one resource directory, as [id, offset] pairs. */
  const entries = async (at: number) => {
    const header = await reader.read(resourceBase + at, 16);
    const count = u16le(header, 12) + u16le(header, 14);
    const list = await reader.read(resourceBase + at + 16, count * 8);
    return Array.from({ length: count }, (_, i) => ({
      id: u32le(list, i * 8),
      target: u32le(list, i * 8 + 4),
    }));
  };
  const isDirectory = (target: number) => (target & 0x80000000) !== 0;
  const offsetOf = (target: number) => target & 0x7fffffff;

  const versionType = (await entries(0)).find(
    (entry) => entry.id === RT_VERSION && isDirectory(entry.target),
  );
  if (!versionType) return [];

  const found: FoundVersion[] = [];
  for (const name of await entries(offsetOf(versionType.target))) {
    if (!isDirectory(name.target)) continue;
    for (const language of await entries(offsetOf(name.target))) {
      if (isDirectory(language.target)) continue;
      const dataEntry = await reader.read(
        resourceBase + offsetOf(language.target),
        16,
      );
      const size = u32le(dataEntry, 4);
      if (size > MAX_VERSION_RESOURCE) continue;
      const blob = await reader.read(toOffset(u32le(dataEntry, 0)), size);
      found.push(...versionInfo(blob));
    }
  }
  return found;
}

/** Reads the VS_VERSIONINFO tree: the fixed numbers and the version strings. */
function versionInfo(blob: Uint8Array): FoundVersion[] {
  const found: FoundVersion[] = [];
  const add = (field: string, raw: string) => {
    const version = normalizeVersion(raw);
    if (version) found.push({ source: "pe", field, raw, version });
  };

  const walk = (start: number, end: number, depth: number) => {
    let at = start;
    while (at + 6 <= end) {
      const length = u16le(blob, at);
      if (length < 6 || at + length > end) return;
      const valueLength = u16le(blob, at + 2);
      const isText = u16le(blob, at + 4) === 1;
      let keyEnd = at + 6;
      while (keyEnd + 1 < at + length && u16le(blob, keyEnd) !== 0) keyEnd += 2;
      const key = utf16le(blob.subarray(at + 6, keyEnd));
      let value = align4(keyEnd + 2);
      const valueBytes = isText ? valueLength * 2 : valueLength;

      if (
        depth === 0 &&
        valueBytes >= 52 &&
        u32le(blob, value) === VS_FIXEDFILEINFO_SIGNATURE
      ) {
        add("FileVersion (fixed)", fixed(blob, value + 8));
        add("ProductVersion (fixed)", fixed(blob, value + 16));
      } else if (isText && STRING_FIELDS.has(key)) {
        const text = utf16le(
          blob.subarray(value, Math.min(value + valueBytes, at + length)),
        );
        add(key, text.replace(/\0+$/, "").trim());
      }

      value = align4(value + valueBytes);
      if (depth < 3) walk(value, at + length, depth + 1);
      at = align4(at + length);
    }
  };
  walk(0, blob.length, 0);
  return found;
}

const align4 = (n: number) => (n + 3) & ~3;

/** A fixed-info version: two DWORDs, most significant first, 16 bits a part. */
function fixed(blob: Uint8Array, at: number) {
  const ms = u32le(blob, at);
  const ls = u32le(blob, at + 4);
  return `${ms >>> 16}.${ms & 0xffff}.${ls >>> 16}.${ls & 0xffff}`;
}
