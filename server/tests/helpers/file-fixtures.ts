import { deflateSync, gzipSync, zstdCompressSync } from "node:zlib";

// Minimal, valid-enough files of each format the inspector reads, built in
// memory so no binaries are committed.

const ascii = (text: string) => Buffer.from(text, "latin1");

function utf16z(text: string) {
  return Buffer.from(`${text}\0`, "utf16le");
}

const pad4 = (buffer: Buffer) =>
  Buffer.concat([buffer, Buffer.alloc((4 - (buffer.length % 4)) % 4)]);

/** One VS_VERSIONINFO node: header, key, padding, value, padding, children. */
function versionNode(
  key: string,
  value: Buffer | string | null,
  children: Buffer[] = [],
) {
  const isText = typeof value === "string";
  const valueBytes =
    value === null ? Buffer.alloc(0) : isText ? utf16z(value) : value;
  const head = pad4(Buffer.concat([Buffer.alloc(6), utf16z(key)]));
  const body = Buffer.concat([pad4(valueBytes), ...children]);
  const node = Buffer.concat([head, body]);
  node.writeUInt16LE(node.length, 0);
  node.writeUInt16LE(isText ? valueBytes.length / 2 : valueBytes.length, 2);
  node.writeUInt16LE(isText ? 1 : 0, 4);
  return pad4(node);
}

/** "1.2.3.4" as VS_FIXEDFILEINFO's two DWORDs. */
function fixedVersion(version: string) {
  const [a, b, c, d] = version.split(".").map(Number);
  const out = Buffer.alloc(8);
  out.writeUInt32LE(((a << 16) | b) >>> 0, 0);
  out.writeUInt32LE(((c << 16) | d) >>> 0, 4);
  return out;
}

export function versionInfo(fileVersion: string, productVersionText: string) {
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  fixedVersion(fileVersion).copy(fixed, 8);
  fixedVersion(fileVersion).copy(fixed, 16);
  const strings = versionNode("040904b0", null, [
    versionNode("CompanyName", "Nanoveu"),
    versionNode("FileVersion", fileVersion),
    versionNode("ProductVersion", productVersionText),
  ]);
  return versionNode("VS_VERSION_INFO", fixed, [
    versionNode("StringFileInfo", null, [strings]),
  ]);
}

/**
 * A PE32+ file with one `.rsrc` section holding RT_VERSION → 1 → 0x409.
 * `paddingBefore` pushes the section far into the file, like a real installer.
 */
export function buildPe(
  options: { version?: Buffer | null; paddingBefore?: number } = {},
) {
  const { version = versionInfo("2.5.0.0", "2.5.0"), paddingBefore = 0 } =
    options;
  const peOffset = 0x80;
  const optionalSize = 240;
  const sectionTable = peOffset + 24 + optionalSize;
  const rsrcOffset = 0x400 + paddingBefore;
  const rsrcRva = 0x2000;

  let rsrc = Buffer.alloc(0);
  if (version) {
    // Three directory levels, each with one id entry, then the data entry
    const dir = (id: number, target: number) => {
      const out = Buffer.alloc(24);
      out.writeUInt16LE(1, 14);
      out.writeUInt32LE(id, 16);
      out.writeUInt32LE(target >>> 0, 20);
      return out;
    };
    const dataEntryAt = 72;
    const dataAt = 88;
    const entry = Buffer.alloc(16);
    entry.writeUInt32LE(rsrcRva + dataAt, 0);
    entry.writeUInt32LE(version.length, 4);
    rsrc = Buffer.concat([
      dir(16, 0x80000000 | 24),
      dir(1, 0x80000000 | 48),
      dir(0x409, dataEntryAt),
      entry,
      version,
    ]);
  }

  const file = Buffer.alloc(rsrcOffset + Math.max(rsrc.length, 16));
  file.write("MZ", 0, "latin1");
  file.writeUInt32LE(peOffset, 0x3c);
  file.write("PE\0\0", peOffset, "latin1");
  file.writeUInt16LE(1, peOffset + 6);
  file.writeUInt16LE(optionalSize, peOffset + 20);
  const optional = peOffset + 24;
  file.writeUInt16LE(0x20b, optional);
  file.writeUInt32LE(16, optional + 108);
  if (version) {
    file.writeUInt32LE(rsrcRva, optional + 112 + 16);
    file.writeUInt32LE(rsrc.length, optional + 112 + 20);
  }
  file.write(".rsrc", sectionTable, "latin1");
  file.writeUInt32LE(rsrc.length, sectionTable + 8);
  file.writeUInt32LE(rsrcRva, sectionTable + 12);
  file.writeUInt32LE(rsrc.length, sectionTable + 16);
  file.writeUInt32LE(rsrcOffset, sectionTable + 20);
  rsrc.copy(file, rsrcOffset);
  return file;
}

/** A tar archive with the given files (only the fields our reader uses). */
export function buildTar(files: Record<string, string>) {
  const parts: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    header.write(name, 0, "latin1");
    header.write("0000644\0", 100, "latin1");
    header.write(
      `${content.length.toString(8).padStart(11, "0")}\0`,
      124,
      "latin1",
    );
    header.write("0", 156, "latin1");
    header.write("ustar\0", 257, "latin1");
    const data = ascii(content);
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function arMember(name: string, data: Buffer) {
  const header = Buffer.alloc(60, " ");
  header.write(name, 0, "latin1");
  header.write("0", 16, "latin1");
  header.write("0", 28, "latin1");
  header.write("0", 34, "latin1");
  header.write("100644", 40, "latin1");
  header.write(String(data.length), 48, "latin1");
  header.write("`\n", 58, "latin1");
  return Buffer.concat([
    header,
    data,
    data.length % 2 ? ascii("\n") : Buffer.alloc(0),
  ]);
}

export const CONTROL =
  "Package: emass-ide\nVersion: 1:2.5.0-1792088006\nArchitecture: amd64\n";

/**
 * `buildTar({ "./": "", "./control": CONTROL })` compressed with
 * `xz -c` (XZ Utils 5.6.4): Node can't write xz.
 */
export const CONTROL_TAR_XZ = Buffer.from(
  "/Td6WFoAAATm1rRGBMCHAYAUIQEWAAAAAAAAABuMBvTgCf8Af10AFwu8HH0Blb/9UxwD8N1tlfN7dhlW8GkUFiT081YLPFcS1xZi4a5ajckzXO1taQP/5y8uxI/4itTnb2ke3cMX/aeKxJBnMzWdKA3mKqr+c5wojqRWfcfaP8IjsmLREMPmdTdRGh8lNhSStp/NfW4Dmoy53K5gi80Eq/1Y0FRNAAAAlgrEJQaQUBMAAaMBgBQAALojy5exxGf7AgAAAAAEWVo=",
  "base64",
);

export function buildDeb(
  control: "gz" | "xz" | "zst" | "none" | "missing" = "gz",
) {
  const tar = buildTar({ "./": "", "./control": CONTROL });
  const members = [arMember("debian-binary", ascii("2.0\n"))];
  if (control === "gz") members.push(arMember("control.tar.gz", gzipSync(tar)));
  if (control === "xz")
    members.push(arMember("control.tar.xz", CONTROL_TAR_XZ));
  if (control === "zst")
    members.push(arMember("control.tar.zst", zstdCompressSync(tar)));
  if (control === "none") members.push(arMember("control.tar", tar));
  if (control === "missing")
    members.push(arMember("data.tar.gz", gzipSync(tar)));
  members.push(arMember("data.tar.gz", gzipSync(Buffer.alloc(2048))));
  return Buffer.concat([ascii("!<arch>\n"), ...members]);
}

export const PACKAGE_INFO = `<?xml version="1.0" encoding="utf-8"?>
<pkg-info identifier="com.nanoveu.emass-ide" version="2.5.0" format-version="2">
  <bundle id="com.github.Squirrel" CFBundleShortVersionString="1.0"/>
  <bundle id="com.electron.reactive" CFBundleShortVersionString="3.1.0"/>
</pkg-info>`;

export const DISTRIBUTION = `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
  <pkg-ref id="com.nanoveu.emass-ide" version="2.5.0">#component.pkg</pkg-ref>
  <pkg-ref id="com.nanoveu.emass-ide"><bundle-version><bundle CFBundleShortVersionString="3.1.0"/></bundle-version></pkg-ref>
</installer-gui-script>`;

/**
 * A product archive (xar): Distribution at the root and the component's
 * PackageInfo one level down, with a payload before or after them.
 */
export function buildPkg(
  options: { metadataAt?: "start" | "end"; payloadSize?: number } = {},
) {
  const { metadataAt = "end", payloadSize = 4096 } = options;
  const payload = Buffer.alloc(payloadSize, 7);
  const packageInfo = deflateSync(ascii(PACKAGE_INFO));
  const distribution = deflateSync(ascii(DISTRIBUTION));
  const metadata = [packageInfo, distribution];
  const heapParts =
    metadataAt === "end" ? [payload, ...metadata] : [...metadata, payload];
  const offsetOf = (part: Buffer) => {
    let at = 0;
    for (const item of heapParts) {
      if (item === part) return at;
      at += item.length;
    }
    throw new Error("part not in heap");
  };
  const data = (part: Buffer, encoding: string, size: number) =>
    `<data><length>${part.length}</length><offset>${offsetOf(part)}</offset><size>${size}</size><encoding style="${encoding}"/></data>`;

  const toc = `<?xml version="1.0" encoding="UTF-8"?>
<xar><toc>
 <file id="1">${data(distribution, "application/x-gzip", DISTRIBUTION.length)}<type>file</type><name>Distribution</name></file>
 <file id="2"><type>directory</type><name>component.pkg</name>
  <file id="3">${data(payload, "application/octet-stream", payload.length)}<ea id="0"><length>3</length><offset>0</offset><name>com.apple.provenance</name></ea><type>file</type><name>Payload</name></file>
  <file id="4">${data(packageInfo, "application/x-gzip", PACKAGE_INFO.length)}<type>file</type><name>PackageInfo</name></file>
 </file>
</toc></xar>`;
  const compressedToc = deflateSync(ascii(toc));
  const header = Buffer.alloc(28);
  header.write("xar!", 0, "latin1");
  header.writeUInt16BE(28, 4);
  header.writeUInt16BE(1, 6);
  header.writeBigUInt64BE(BigInt(compressedToc.length), 8);
  header.writeBigUInt64BE(BigInt(toc.length), 16);
  header.writeUInt32BE(1, 24);
  return Buffer.concat([header, compressedToc, ...heapParts]);
}

/** A classic PDF whose Info dictionary is a plain object. */
export function buildPdf(info: string, options: { truncate?: boolean } = {}) {
  const body = `%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\n2 0 obj\n<<${info}>>\nendobj\n`;
  const trailer = `xref\n0 3\ntrailer\n<</Size 3/Root 1 0 R/Info 2 0 R>>\nstartxref\n${body.length}\n%%EOF\n`;
  const pdf = ascii(body + trailer);
  return options.truncate ? pdf.subarray(0, pdf.length - 20) : pdf;
}

/** A PDF 1.5 file with Info packed into a compressed object stream. */
export function buildPdfWithObjectStream(info: string) {
  const objects = `<<${info}>>`;
  const header = "7 0 ";
  const content = deflateSync(ascii(header + objects));
  const head = ascii(
    `%PDF-1.7\n1 0 obj\n<</Type/Catalog>>\nendobj\n5 0 obj\n<</Type/ObjStm/N 1/First ${header.length}/Filter/FlateDecode/Length ${content.length}>>\nstream\n`,
  );
  const tail = ascii(
    `\nendstream\nendobj\n6 0 obj\n<</Type/XRef/Size 8/Root 1 0 R/Info 7 0 R>>\nstream\n\nendstream\nendobj\nstartxref\n0\n%%EOF\n`,
  );
  return Buffer.concat([head, content, tail]);
}

/** Assembles numbered objects into a PDF body, recording each one's offset. */
function pdfBody(start: Buffer, objects: [number, Buffer | string][]) {
  const offsets = new Map<number, number>();
  const parts: Buffer[] = [start];
  let at = start.length;
  for (const [num, content] of objects) {
    const object = Buffer.concat([
      ascii(`${num} 0 obj\n`),
      typeof content === "string" ? ascii(content) : content,
      ascii("\nendobj\n"),
    ]);
    offsets.set(num, at);
    parts.push(object);
    at += object.length;
  }
  return { body: Buffer.concat(parts), offsets };
}

function xrefTable(offsets: Map<number, number>, from: number, to: number) {
  const rows = [`xref\n${from} ${to - from + 1}\n`];
  for (let num = from; num <= to; num++) {
    const offset = offsets.get(num);
    rows.push(
      offset === undefined
        ? "0000000000 65535 f\r\n"
        : `${String(offset).padStart(10, "0")} 00000 n\r\n`,
    );
  }
  return rows.join("");
}

function pdfStream(dict: string, data: Buffer) {
  return Buffer.concat([
    ascii(`<<${dict}/Length ${data.length}>>\nstream\n`),
    data,
    ascii("\nendstream"),
  ]);
}

/**
 * A well-formed PDF with a real xref table: catalog, pages, Info and an
 * optional compressed XMP stream. `paddingBytes` puts a filler stream
 * between the header and Info, so Info sits far from both ends.
 */
export function buildPdfDocument(
  options: {
    info?: string;
    xmpDescription?: string;
    paddingBytes?: number;
  } = {},
) {
  const {
    info = "/Subject(EMASS Version 2.5.0)",
    xmpDescription,
    paddingBytes = 0,
  } = options;
  const objects: [number, Buffer | string][] = [
    [
      1,
      `<</Type/Catalog/Pages 2 0 R${xmpDescription ? "/Metadata 5 0 R" : ""}>>`,
    ],
    [2, "<</Type/Pages/Kids[]/Count 0>>"],
  ];
  if (paddingBytes > 0)
    objects.push([6, pdfStream("", Buffer.alloc(paddingBytes, 0x20))]);
  objects.push([3, `<<${info}>>`]);
  if (xmpDescription) {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><dc:description><rdf:Alt><rdf:li>${xmpDescription}</rdf:li></rdf:Alt></dc:description></x:xmpmeta>`;
    objects.push([
      5,
      pdfStream(
        "/Type/Metadata/Subtype/XML/Filter/FlateDecode",
        deflateSync(ascii(xmp)),
      ),
    ]);
  }
  const { body, offsets } = pdfBody(ascii("%PDF-1.7\n"), objects);
  const xref = xrefTable(offsets, 0, 6);
  return Buffer.concat([
    body,
    ascii(
      `${xref}trailer\n<</Size 7/Root 1 0 R/Info 3 0 R>>\nstartxref\n${body.length}\n%%EOF\n`,
    ),
  ]);
}

/**
 * An incremental update of `buildPdfDocument`: a new Info object and an xref
 * section chained to the original by /Prev. Only the new Info is current.
 */
export function withUpdatedInfo(pdf: Buffer, info: string) {
  const prev = /startxref\s+(\d+)/.exec(pdf.toString("latin1").slice(-64))![1];
  const object = ascii(`3 0 obj\n<<${info}>>\nendobj\n`);
  const objectAt = pdf.length;
  const xrefAt = objectAt + object.length;
  const xref = `xref\n3 1\n${String(objectAt).padStart(10, "0")} 00000 n\r\n`;
  return Buffer.concat([
    pdf,
    object,
    ascii(
      `${xref}trailer\n<</Size 7/Root 1 0 R/Info 3 0 R/Prev ${prev}>>\nstartxref\n${xrefAt}\n%%EOF\n`,
    ),
  ]);
}

/**
 * A PDF 1.5 file: Info packed in a compressed object stream and found only
 * through a compressed xref stream that uses the PNG Up predictor.
 */
export function buildPdfWithXrefStream(info: string) {
  const packedHeader = "3 0 ";
  const packed = pdfStream(
    `/Type/ObjStm/N 1/First ${packedHeader.length}/Filter/FlateDecode`,
    deflateSync(ascii(`${packedHeader}<<${info}>>`)),
  );
  const { body, offsets } = pdfBody(ascii("%PDF-1.7\n"), [
    [1, "<</Type/Catalog/Pages 2 0 R>>"],
    [2, "<</Type/Pages/Kids[]/Count 0>>"],
    [4, packed],
  ]);
  const xrefAt = body.length;
  // W [1 4 2]: type, offset or object-stream number, generation or index
  const rows: [number, number, number][] = [
    [0, 0, 65535],
    [1, offsets.get(1)!, 0],
    [1, offsets.get(2)!, 0],
    [2, 4, 0],
    [1, offsets.get(4)!, 0],
    [1, xrefAt, 0],
  ];
  const raw = Buffer.alloc(rows.length * 7);
  rows.forEach(([type, second, third], i) => {
    raw.writeUInt8(type, i * 7);
    raw.writeUInt32BE(second, i * 7 + 1);
    raw.writeUInt16BE(third, i * 7 + 5);
  });
  // PNG Up predictor: each row is filter byte 2, then the byte-wise difference
  const predicted = Buffer.alloc(rows.length * 8);
  for (let row = 0; row < rows.length; row++) {
    predicted[row * 8] = 2;
    for (let col = 0; col < 7; col++) {
      const above = row > 0 ? raw[(row - 1) * 7 + col] : 0;
      predicted[row * 8 + 1 + col] = (raw[row * 7 + col] - above) & 0xff;
    }
  }
  const xrefStream = Buffer.concat([
    ascii("5 0 obj\n"),
    pdfStream(
      "/Type/XRef/Size 6/W[1 4 2]/Root 1 0 R/Info 3 0 R/Filter/FlateDecode/DecodeParms<</Predictor 12/Columns 7>>",
      deflateSync(predicted),
    ),
    ascii("\nendobj\n"),
  ]);
  return Buffer.concat([
    body,
    xrefStream,
    ascii(`startxref\n${xrefAt}\n%%EOF\n`),
  ]);
}
