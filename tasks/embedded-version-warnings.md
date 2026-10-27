# Task: embedded-version warnings on release uploads (future)

**Status:** idea, not started. It builds on the checksum and filename
warnings, which are done (`server/src/services/releases/file-warnings.service.ts`,
documented in `server/docs/releases/release-management.md`).

## Goal

Read the version a file carries **inside** it, best effort, while it uploads.
Warn when that version belongs to an older release of the same product. When a
format holds no version, or we can't reach it, do nothing. No noise.

## Catches

1. **We see each byte once, in order, while it streams to OCI.** There's no
   going back and no buffering of multi-GB files. Only formats whose version can
   be reached while streaming are covered:
   - **Windows PE (.exe/.dll):** `VS_FIXEDFILEINFO` begins with the fixed
     4-byte signature `0xFEEF04BD` (bytes `BD 04 EF FE`). A rolling
     `Buffer.indexOf` scan, with a 52-byte carry-over between chunks, finds it
     anywhere in the stream. `dwFileVersionMS/LS` give `a.b.c.d`.
   - **Ubuntu .deb:** an `ar` archive (`!<arch>\n`, then `debian-binary`). Its
     second member, `control.tar.{gz,zst}`, sits a few KB in, and its
     `./control` file has a `Version:` line. gzip and zstd are built into Node
     22.17 (`zlib.gunzipSync`, `zstdDecompressSync`). **xz is not**, so an xz
     control gives nothing.
2. **Out of reach, so nothing happens:**
   - `.dmg`: compressed disk image; the version is in an Info.plist deep inside.
   - `.pkg`: xar container.
   - `.msi`: OLE compound file; the version is in the Property table.
   - Raw Mach-O: has OS/SDK versions only.
   - `.zip` and `.tar.gz`: no version field.
   - PDF: has Producer and Title, no version.

   So the macOS SDK and docs get no embedded check.
3. **Noise.** PE versions are often `0.0.0.0` / `1.0.0.0` defaults or internal
   build numbers (`25.3.1.1042`), so "embedded ≠ release version" would fire
   constantly.
   - **Rule:** warn only when the embedded `a.b.c` **equals the version of a
     different release of the same product**, for example "Built as 1.2.0,
     the version of v1.2.0 (Published)".
   - `0.0.0` is ignored, and so is a match with the release's own version.
   - This catches an old build whose bytes changed (re-signed, re-zipped), so
     the checksum didn't match.
4. **Hot path and safety:**
   - It runs inside the existing `hashing()` generator in
     `release-files.service.ts`.
   - It never throws: any error turns the sniffer off.
   - It stops once a version is found, and gives up on .deb after 64 MiB.
   - Decompression output is capped at 1 MiB (`maxOutputLength`), against zip
     bombs, and every header read is bounds-checked.
   - The upload never waits on it or fails because of it.
5. **It must be stored.** Warnings are computed when the release is read, and
   reads can't re-download the object. That needs a nullable
   `ReleaseFile.embeddedVersion` column, **a migration the user runs**. Older
   files stay null, and null means no check.
6. **Maintenance:** two small hand-written binary parsers to keep correct.

## Plan

1. **Schema:** add `embeddedVersion String?` to `ReleaseFile`. The user runs
   `npx prisma migrate dev --name release_file_embedded_version` and
   `npm run test:migrate`.
2. **Parser:** a pure `server/src/services/releases/file-metadata.utils.ts`
   with no I/O:
   - `createVersionSniffer()` returns
     `{ push(chunk: Buffer): void; result(): string | null }`.
   - It picks the format from the first chunk's magic bytes (`MZ` → PE,
     `!<arch>\ndebian-binary` → deb), never from the extension. Anything else
     is a no-op.
   - **PE:** find the signature, check `dwStrucVersion`, and read the first
     three parts of the file version.
   - **deb:** a tiny `ar` member parser (60-byte headers) collects
     `control.tar.*`, up to the cap. It decompresses it and walks the tar
     headers (512-byte blocks) to `./control`, then reads `Version:`. The
     epoch and revision are stripped: `1:1.2.0-1ubuntu1` → `1.2.0`.
   - Versions are normalised with the existing `parseVersion` /
     `formatVersion` (`releases.utils.ts`).
3. **Wiring:**
   - `hashing()` also calls `sniffer.push(chunk)`, and the create saves
     `embeddedVersion: sniffer.result()`.
   - `presentFile` exposes `embeddedVersion`.
   - `fileWarnings` adds
     `{ code: "EMBEDDED_VERSION_MATCH", found, match: { releaseId, version, status } }`.
     It uses one query: releases of the same product whose `version` is in
     the distinct embedded versions, excluding this release.
   - The warning stays advisory: nothing is blocked.
4. **Client:**
   - `FileWarning` gets `{ type: "embeddedVersion"; found; version; status }`.
   - The mapper in `releases.mappers.ts` reads it, and `fileWarningText` in
     `Releases/file-warnings.ts` renders the line.
   - `StagedFileRow`, the upload toast and the review callout already render
     every warning, so nothing else changes.

## Tests

- **Unit** (`tests/unit/file-metadata.utils.test.ts`), with synthetic buffers
  built in the test so no binaries are committed:
  - PE with the signature split across two chunks → `1.2.0`;
  - PE with `0.0.0.0` → null;
  - .deb built from `ar` + a gzip tar with control `Version: 2:1.4.0-3` →
    `1.4.0`;
  - .deb with a zst control → read;
  - .deb with an xz control → null;
  - truncated or corrupt headers → no throw, null;
  - control past the 1 MiB cap → null;
  - random bytes, PDF and zip → null.
- **Integration** (`tests/integration/release-files.test.ts`):
  - a synthetic PE carrying 1.2.0, uploaded into v1.3.0 while v1.2.0 exists →
    `EMBEDDED_VERSION_MATCH`;
  - the same file in a product with no v1.2.0 → no warning;
  - `embeddedVersion` saved on the row.
- **Client:** the mapper and `fileWarningText` cases.

## Docs

- `server/docs/releases/release-management.md`: replace the "Not done: binary
  metadata" bullet with what's covered (PE, deb gz/zst), what isn't, and why
  the rule is "matches another release's version".
- OpenAPI: add `embeddedVersion` and the new warning code to the file schema in
  `scripts/openapi-releases.ts`, then run `npm run docs`.

## Verification

- **Server:** `npx dotenv -e .env.test -- vitest run`, then `npm run lint`.
- **Client:** `npx tsc -b`, `npx eslint src`, `npx vitest run`, `npm run build`.
- **Manual:** upload a real signed Windows installer whose version resource
  says the previous release's version. The warning shows in the editor and the
  review callout. A .dmg or PDF uploads with no warning.
