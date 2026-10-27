import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  inspectFile,
  type Inspection,
} from "../../src/services/releases/file-inspect/inspect.js";
import { dictString } from "../../src/services/releases/file-inspect/pdf.js";
import {
  bufferReader,
  NeedBytes,
  suppliedReader,
} from "../../src/services/releases/file-inspect/range-reader.js";
import {
  buildDeb,
  buildPdf,
  buildPdfWithObjectStream,
  buildPe,
  buildPkg,
  versionInfo,
} from "../helpers/file-fixtures.js";

const inspect = (file: Uint8Array, name = "file.bin") =>
  inspectFile(bufferReader(file), name);

/** What the format parsers found inside the file, by field. */
const inside = (result: Inspection) =>
  result.versions
    .filter((found) => found.source !== "name")
    .map((found) => `${found.field}=${found.version}`);

describe("PE (.exe)", () => {
  it("reads the fixed and string versions of the version resource", async () => {
    const result = await inspect(
      buildPe({ paddingBefore: 300_000 }),
      "setup.exe",
    );
    expect(result).toMatchObject({
      format: "PE",
      damaged: null,
      incomplete: false,
    });
    expect(inside(result)).toEqual([
      "FileVersion (fixed)=2.5.0",
      "ProductVersion (fixed)=2.5.0",
      "FileVersion=2.5.0",
      "ProductVersion=2.5.0",
    ]);
  });

  it("finds nothing, without failing, when there is no version resource", async () => {
    const result = await inspect(buildPe({ version: null }));
    expect(result).toMatchObject({ format: "PE", damaged: null, versions: [] });
  });

  it("ignores the 0.0.0.0 placeholder", async () => {
    const result = await inspect(
      buildPe({ version: versionInfo("0.0.0.0", "0.0.0.0") }),
    );
    expect(result.versions).toEqual([]);
  });

  it("reports a PE header pointing past the end", async () => {
    const file = buildPe();
    file.writeUInt32LE(file.length + 10, 0x3c);
    expect((await inspect(file)).damaged).toMatch(
      /Not a valid Windows executable/,
    );
  });

  it("reports a missing PE signature", async () => {
    const file = buildPe();
    file.write("XX", 0x80, "latin1");
    expect((await inspect(file)).damaged).toBe(
      "Not a valid Windows executable: the PE signature is missing.",
    );
  });
});

describe("Debian package (.deb)", () => {
  it.each(["gz", "xz", "zst", "none"] as const)(
    "reads Version: from a control.tar (%s), without epoch or revision",
    async (compression) => {
      const result = await inspect(buildDeb(compression), "emass.deb");
      expect(result).toMatchObject({ format: "DEB", damaged: null });
      expect(result.versions.at(-1)).toMatchObject({
        source: "deb",
        raw: "1:2.5.0-1792088006",
        version: "2.5.0",
      });
    },
  );

  it("reports a missing control archive", async () => {
    expect((await inspect(buildDeb("missing"))).damaged).toBe(
      "Not a valid .deb: the control archive is missing.",
    );
  });

  it("reports a corrupt control archive", async () => {
    const file = buildDeb("gz");
    const at = file.indexOf("control.tar.gz") + 60 + 20;
    file.fill(0xff, at, at + 40);
    expect((await inspect(file)).damaged).toBe(
      "Not a valid .deb: the control archive can't be decompressed.",
    );
  });

  it("treats other ar archives (static libraries) as unknown files", async () => {
    const lib = Buffer.concat([
      Buffer.from("!<arch>\n"),
      Buffer.alloc(120, " "),
    ]);
    expect(await inspect(lib, "libemass.a")).toMatchObject({
      format: "OTHER",
      damaged: null,
    });
  });
});

describe("macOS package (.pkg)", () => {
  it.each(["start", "end"] as const)(
    "reads PackageInfo and Distribution with metadata at the %s of the heap",
    async (metadataAt) => {
      const result = await inspect(
        buildPkg({ metadataAt, payloadSize: 200_000 }),
        "emass.pkg",
      );
      expect(result).toMatchObject({ format: "PKG", damaged: null });
      // Bundled frameworks (1.0, 3.1.0) never count
      expect(inside(result).sort()).toEqual([
        "pkg-info version=2.5.0",
        "pkg-ref version=2.5.0",
      ]);
    },
  );

  it("reports a table of contents that can't be decompressed", async () => {
    const file = buildPkg();
    file.fill(0xff, 28, 40);
    expect((await inspect(file)).damaged).toBe(
      "Not a valid .pkg: the table of contents can't be decompressed.",
    );
  });

  it("reports a cut-short archive", async () => {
    const file = buildPkg();
    expect((await inspect(file.subarray(0, 60))).damaged).toBe(
      "Not a valid .pkg: the table of contents runs past the end of the file.",
    );
  });
});

describe("PDF", () => {
  it("reads Title and Subject from the Info dictionary", async () => {
    const result = await inspect(
      buildPdf("/Title(EMASS IDE User Guide) /Subject(EMASS IDE Version 1.4)"),
      "guide.pdf",
    );
    expect(result).toMatchObject({ format: "PDF", damaged: null });
    expect(inside(result)).toEqual(["Info Subject=1.4.0"]);
  });

  it("reads Info packed into a compressed object stream", async () => {
    const result = await inspect(
      buildPdfWithObjectStream("/Subject(Version 2.5.0)"),
    );
    expect(inside(result)).toEqual(["Info Subject=2.5.0"]);
  });

  it("reads UTF-16 hex strings", async () => {
    const hex = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from("v2.5.0", "utf16le").swap16(),
    ]).toString("hex");
    const result = await inspect(buildPdf(`/Title<${hex}>`));
    expect(inside(result)).toEqual(["Info Title=2.5.0"]);
  });

  it("reads the XMP description in a compressed metadata stream", async () => {
    const xmp = Buffer.from(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:description><rdf:Alt><rdf:li>EMASS Version 3.1.2</rdf:li></rdf:Alt></dc:description></x:xmpmeta>',
    );
    const packed = deflateSync(xmp);
    const file = Buffer.concat([
      Buffer.from(
        `%PDF-1.7\n4 0 obj\n<</Type/Metadata/Subtype/XML/Filter/FlateDecode/Length ${packed.length}>>\nstream\n`,
      ),
      packed,
      Buffer.from("\nendstream\nendobj\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n"),
    ]);
    expect(inside(await inspect(file))).toEqual(["XMP description=3.1.2"]);
  });

  it("reports a cut-short PDF", async () => {
    const result = await inspect(buildPdf("/Subject(x)", { truncate: true }));
    expect(result.damaged).toBe(
      "Not a valid PDF: the file is cut short (no end-of-file marker).",
    );
  });

  it("decodes literal-string escapes", () => {
    expect(dictString("/Title(a\\(b\\) \\101\\n)", "Title")).toBe("a(b) A\n");
  });
});

describe("inspectFile", () => {
  it("adds the file name's versions to what's inside", async () => {
    const result = await inspect(buildPe(), "EMASS_2.4.0_win.exe");
    expect(result.versions[0]).toEqual({
      source: "name",
      field: "file name",
      raw: "EMASS_2.4.0_win.exe",
      version: "2.4.0",
    });
  });

  it("reads only the name of unknown formats", async () => {
    const result = await inspect(
      Buffer.from("PK\u0003\u0004 zip bytes"),
      "emass-1.0.0.zip",
    );
    expect(result).toMatchObject({ format: "OTHER", damaged: null });
    expect(result.versions.map((found) => found.version)).toEqual(["1.0.0"]);
  });

  it("handles empty files", async () => {
    expect(await inspect(new Uint8Array(0), "empty")).toMatchObject({
      format: "OTHER",
      versions: [],
    });
  });

  it("completes in a few round trips when a client supplies the bytes", async () => {
    const file = buildPe({ paddingBefore: 1_000_000 });
    const supplied: { offset: number; data: Uint8Array }[] = [];
    let rounds = 0;
    for (;;) {
      rounds++;
      try {
        const result = await inspectFile(
          suppliedReader(file.length, supplied),
          "setup.exe",
        );
        expect(inside(result)).toContain("ProductVersion=2.5.0");
        break;
      } catch (error) {
        if (!(error instanceof NeedBytes)) throw error;
        for (const { offset, length } of error.ranges) {
          supplied.push({
            offset,
            data: file.subarray(offset, offset + length),
          });
        }
      }
    }
    expect(rounds).toBeLessThanOrEqual(4);
    const sent = supplied.reduce((sum, { data }) => sum + data.length, 0);
    expect(sent).toBeLessThanOrEqual(3 * 64 * 1024);
  });
});
