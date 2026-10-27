import { describe, expect, it } from "vitest";
import { inspectFile } from "../../src/services/releases/file-inspect/inspect.js";
import {
  PdfObjects,
  Unfollowable,
} from "../../src/services/releases/file-inspect/pdf-objects.js";
import {
  blockReader,
  bufferReader,
} from "../../src/services/releases/file-inspect/range-reader.js";
import {
  buildPdfDocument,
  buildPdfWithXrefStream,
  withUpdatedInfo,
} from "../helpers/file-fixtures.js";

/** Inspects in memory, counting the bytes the parser asked for. */
async function inspectCounting(file: Buffer) {
  let bytesRead = 0;
  const reader = blockReader(file.length, async (ranges) =>
    ranges.map(({ offset, length }) => {
      bytesRead += length;
      return file.subarray(offset, offset + length);
    }),
  );
  const result = await inspectFile(reader, "doc.pdf");
  const inside = result.versions
    .filter((found) => found.source === "pdf")
    .map((found) => `${found.field}=${found.version}`);
  return { result, inside, bytesRead };
}

describe("PDF: following the file's own pointers", () => {
  it("reads Info and the compressed XMP through the xref table", async () => {
    const { result, inside } = await inspectCounting(
      buildPdfDocument({
        info: "/Title(EMASS Guide)/Subject(EMASS Version 2.5.0)",
        xmpDescription: "EMASS Version 2.5.0",
      }),
    );
    expect(result).toMatchObject({ format: "PDF", damaged: null });
    expect(inside).toEqual(["Info Subject=2.5.0", "XMP description=2.5.0"]);
  });

  it("finds Info in the middle of a large PDF while reading only a little of it", async () => {
    const pdf = buildPdfDocument({ paddingBytes: 12 * 1024 * 1024 });
    const { inside, bytesRead } = await inspectCounting(pdf);

    expect(pdf.length).toBeGreaterThan(12 * 1024 * 1024);
    expect(inside).toEqual(["Info Subject=2.5.0"]);
    expect(bytesRead).toBeLessThan(512 * 1024);
  });

  it("reads Info packed in an object stream, found through an xref stream", async () => {
    const { inside } = await inspectCounting(
      buildPdfWithXrefStream("/Subject(EMASS Version 3.1.0)"),
    );
    expect(inside).toEqual(["Info Subject=3.1.0"]);
  });

  it("uses only the newest Info after an incremental update", async () => {
    const original = buildPdfDocument({
      info: "/Subject(EMASS Version 1.0.0)",
    });
    const { inside } = await inspectCounting(
      withUpdatedInfo(original, "/Subject(EMASS Version 2.0.0)"),
    );
    expect(inside).toEqual(["Info Subject=2.0.0"]);
  });

  it("falls back to scanning the file when startxref points nowhere useful", async () => {
    const pdf = buildPdfDocument({ info: "/Subject(EMASS Version 4.2.0)" });
    const broken = Buffer.from(
      pdf.toString("latin1").replace(/startxref\s+\d+/, "startxref\n5"),
      "latin1",
    );
    const { result, inside } = await inspectCounting(broken);
    expect(result.damaged).toBeNull();
    expect(inside).toEqual(["Info Subject=4.2.0"]);
  });
});

describe("PdfObjects", () => {
  it("resolves objects through a predicted xref stream and an object stream", async () => {
    const pdf = buildPdfWithXrefStream("/Subject(EMASS Version 3.1.0)");
    const startxref = Number(
      /startxref\s+(\d+)/.exec(pdf.toString("latin1").slice(-64))![1],
    );
    const objects = await PdfObjects.open(bufferReader(pdf), startxref);

    expect(objects.info).toBe(3);
    expect(objects.root).toBe(1);
    expect(await objects.object(3)).toContain("EMASS Version 3.1.0");
    expect(await objects.object(1)).toContain("/Type/Catalog");
  });

  it("refuses an object that isn't where the xref says", async () => {
    const pdf = buildPdfDocument();
    const text = pdf.toString("latin1");
    const startxref = Number(/startxref\s+(\d+)/.exec(text.slice(-64))![1]);
    // Point object 3's xref row at object 2
    const objectTwoAt = text.indexOf("2 0 obj");
    const tampered = Buffer.from(
      text.replace(
        /(xref\n0 7\n(?:.{18}\r\n){3})\d{10}/,
        `$1${String(objectTwoAt).padStart(10, "0")}`,
      ),
      "latin1",
    );
    const objects = await PdfObjects.open(bufferReader(tampered), startxref);
    await expect(objects.object(3)).rejects.toBeInstanceOf(Unfollowable);
  });
});
