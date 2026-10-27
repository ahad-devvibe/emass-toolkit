import { latin1, startsWith, utf8 } from "./bytes.js";
import { inflate, MAX_DECOMPRESSED, unxz, unzstd } from "./decompress.js";
import { BudgetExceeded, Damaged, type RangeReader } from "./range-reader.js";
import type { FoundVersion } from "./types.js";
import { normalizeVersion } from "./versions.js";

const AR_MAGIC = "!<arch>\n";
const AR_HEADER = 60;

const CONTROL_DECODERS: Record<
  string,
  (packed: Uint8Array) => Uint8Array | Promise<Uint8Array>
> = {
  "control.tar": (packed) => packed,
  "control.tar.gz": inflate,
  "control.tar.xz": unxz,
  "control.tar.zst": unzstd,
};

const invalid = (why: string) => new Damaged(`Not a valid .deb: ${why}.`);

interface ArMember {
  name: string;
  offset: number;
  size: number;
}

async function arMember(reader: RangeReader, at: number): Promise<ArMember> {
  if (at + AR_HEADER > reader.size) throw invalid("the archive is cut short");
  const header = latin1(await reader.read(at, AR_HEADER));
  if (header.slice(58, 60) !== "`\n")
    throw invalid("an archive header is broken");
  const size = Number(header.slice(48, 58).trim());
  if (!Number.isSafeInteger(size) || at + AR_HEADER + size > reader.size) {
    throw invalid("an archive member runs past the end of the file");
  }
  // GNU ar ends names with "/"
  return {
    name: header.slice(0, 16).trim().replace(/\/$/, ""),
    offset: at + AR_HEADER,
    size,
  };
}

/**
 * Whether this ar archive is a Debian package: dpkg requires `debian-binary`
 * as the first member. Other ar archives (static libraries) aren't .deb files.
 */
export async function isDebianArchive(reader: RangeReader) {
  if (reader.size < AR_MAGIC.length + AR_HEADER) return false;
  const header = await reader.read(AR_MAGIC.length, 16);
  return startsWith(header, "debian-binary");
}

/**
 * The package's `Version:` from its control file. dpkg requires the control
 * archive to be the second member, so this reads only the first few KB.
 */
export async function debVersions(
  reader: RangeReader,
): Promise<FoundVersion[]> {
  const first = await arMember(reader, AR_MAGIC.length);
  const control = await arMember(
    reader,
    first.offset + first.size + (first.size % 2),
  );
  if (!control.name.startsWith("control.tar")) {
    throw invalid("the control archive is missing");
  }
  if (control.size > MAX_DECOMPRESSED)
    throw new BudgetExceeded("Control archive too large");

  const decode = CONTROL_DECODERS[control.name];
  if (!decode) throw invalid(`${control.name} uses an unknown compression`);
  const packed = await reader.read(control.offset, control.size);
  let tar: Uint8Array;
  try {
    tar = await decode(packed);
  } catch (error) {
    if (error instanceof BudgetExceeded) throw error;
    throw invalid("the control archive can't be decompressed");
  }

  const file = tarEntry(tar, "control");
  if (!file) throw invalid("the control file is missing");
  const line = /^Version:[ \t]*(.+?)[ \t]*$/m.exec(utf8(file));
  if (!line) return [];
  const version = normalizeVersion(line[1]);
  return version
    ? [{ source: "deb", field: "Version:", raw: line[1], version }]
    : [];
}

/** A regular file's contents from a tar archive, matched with or without "./". */
function tarEntry(tar: Uint8Array, wanted: string): Uint8Array | null {
  for (let at = 0; at + 512 <= tar.length;) {
    const header = latin1(tar.subarray(at, at + 512));
    const name = header.slice(0, 100).replace(/\0.*$/s, "");
    if (!name) return null;
    const prefix = header.slice(345, 500).replace(/\0.*$/s, "");
    const size = parseInt(
      header.slice(124, 136).replace(/\0.*$/s, "").trim() || "0",
      8,
    );
    const type = header[156];
    const path = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, "");
    const data = at + 512;
    if (!Number.isSafeInteger(size) || data + size > tar.length) return null;
    if (path === wanted && (type === "0" || type === "\0")) {
      return tar.subarray(data, data + size);
    }
    at = data + Math.ceil(size / 512) * 512;
  }
  return null;
}
