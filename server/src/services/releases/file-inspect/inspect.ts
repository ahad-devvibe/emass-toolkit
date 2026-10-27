import { latin1, startsWith } from "./bytes.js";
import { debVersions, isDebianArchive } from "./deb.js";
import { pdfVersions } from "./pdf.js";
import { peVersions } from "./pe.js";
import {
  BudgetExceeded,
  Damaged,
  OutOfBounds,
  type RangeReader,
} from "./range-reader.js";
import type { FileFormat, FoundVersion } from "./types.js";
import { versionsInText } from "./versions.js";
import { pkgVersions } from "./xar.js";

export interface Inspection {
  format: FileFormat;
  /** Every version found, in the name and inside the file. */
  versions: FoundVersion[];
  /** Why the file is certainly broken (shown to the developer); null if not. */
  damaged: string | null;
  /** The file's metadata couldn't be read within READ_BUDGET. */
  incomplete: boolean;
}

const DAMAGED_MESSAGE: Record<Exclude<FileFormat, "OTHER">, string> = {
  PE: "Not a valid Windows executable: its structure points past the end of the file.",
  DEB: "Not a valid .deb: its structure points past the end of the file.",
  PKG: "Not a valid .pkg: its structure points past the end of the file.",
  PDF: "Not a valid PDF: its structure points past the end of the file.",
};

/** The format, from the first bytes; the extension is never trusted. */
export async function detectFormat(reader: RangeReader): Promise<FileFormat> {
  const head = await reader.read(0, Math.min(1024, reader.size));
  if (startsWith(head, "MZ")) return "PE";
  if (startsWith(head, "xar!")) return "PKG";
  if (startsWith(head, "!<arch>\n") && (await isDebianArchive(reader)))
    return "DEB";
  // The spec allows junk before the header, within the first 1 KB
  if (latin1(head).includes("%PDF-")) return "PDF";
  return "OTHER";
}

const PARSERS: Record<
  Exclude<FileFormat, "OTHER">,
  (reader: RangeReader) => Promise<FoundVersion[]>
> = {
  PE: peVersions,
  DEB: debVersions,
  PKG: pkgVersions,
  PDF: pdfVersions,
};

/**
 * What a file says about its version, by name and by content. Reads only what
 * each format's structure points to. NeedBytes propagates, so a caller
 * holding only some of the bytes can fetch the rest and call again.
 */
export async function inspectFile(
  reader: RangeReader,
  fileName: string,
): Promise<Inspection> {
  const versions: FoundVersion[] = versionsInText(fileName).map((version) => ({
    source: "name",
    field: "file name",
    raw: fileName,
    version,
  }));
  const result: Inspection = {
    format: "OTHER",
    versions,
    damaged: null,
    incomplete: false,
  };
  if (reader.size === 0) return result;

  try {
    result.format = await detectFormat(reader);
    if (result.format !== "OTHER") {
      versions.push(...(await PARSERS[result.format](reader)));
    }
  } catch (error) {
    if (error instanceof Damaged) result.damaged = error.message;
    else if (error instanceof OutOfBounds && result.format !== "OTHER") {
      result.damaged = DAMAGED_MESSAGE[result.format];
    } else if (error instanceof BudgetExceeded) result.incomplete = true;
    else throw error;
  }
  return result;
}
