# Release file checks

## What was built

Every release file is checked **before** it uploads and checked again on the
server after it lands. A stale or duplicate installer can't enter a release,
even from a modified client.

**Before the upload (in the editor):**
1. **Version check.** `POST /api/releases/:id/files/check` with `{ name, size }`.
   The server answers `NEED_BYTES` with the byte ranges it wants. The browser
   sends those slices back, base64, until the server has the versions. This
   takes 2–5 round trips and a few KB in total.
2. **Hash.** A Web Worker (`hash-wasm`, 8 MiB chunks) computes the SHA-256.
3. **Final check.** The browser repeats the call with `sha256` and the ranges
   it already has. The server is stateless and parses them again.
4. **Upload** (`POST /releases/:id/files`, busboy → OCI multipart, two at a
   time). The `sha256` field is required.

**After the upload (on the server):**
- A computed hash that differs from the declared one gives
  `422 CHECKSUM_MISMATCH`.
- The stored object is parsed again with ranged reads (`StorageDriver.readRange`),
  and the rules run again.
- On a block, the server answers `409 FILE_BLOCKED` and deletes the object.
- `format` and `detectedVersions` are stored on `ReleaseFile`.

**Verdicts on read and on submit:**
- Files of DRAFT, CHANGES_REQUESTED and IN_REVIEW releases carry `blockedBy`
  and `warnings` (`releaseFileVerdicts`). Shipped releases are never judged.
- Submit judges every file again:
  - a block → `409 FILE_BLOCKED` with `details.files`;
  - warnings without `confirmWarnings: true` → `409 FILE_WARNINGS_UNCONFIRMED`;
  - confirmed warnings are listed in the `SUBMITTED` event note, so the admin
    sees them in Activity.

**Code:**
- Parser: `src/services/releases/file-inspect/` (pe, deb, xar, pdf and name
  parsers, `inspectFile`).
- Rules: `file-checks.utils.ts` (`evaluateFile`).
- DB facts and the check endpoint: `file-checks.service.ts`.
- Client: `client/src/lib/hash/`, `pages/ReleaseEditor/file-check.ts`, and the
  upload queue.

## Key decisions

- **Installers** (PE / DEB / PKG, recognised by their first bytes, not the
  extension or the developer's mapping) are **blocked**, with no override:
  - `SAME_CONTENT`: identical bytes in any release, rolled-back ones included;
  - `VERSION_MISMATCH`: a version in the name or inside the file isn't the
    release's version;
  - `VERSION_EXISTS`: that version already exists for the product. It's kept
    separate from `VERSION_MISMATCH` for its clearer message.
- **Docs** (PDF and every format we don't parse) only **warn**:
  - `DOC_VERSION_MISMATCH`: re-shipping last release's guide is normal;
  - `NO_VERSION`: applies to any file;
  - no checksum check across releases. It could only catch the legitimate
    "keep last release's doc" case.
  - Docs are still blocked for the same bytes twice in one release
    (`@@unique([releaseId, sha256])`).
- **`DAMAGED` blocks only when the damage is certain:** the first bytes claim a
  format, but its structure breaks that format's rules. Unusual but valid files,
  and formats we don't parse, are never "damaged".
- **The parser lives only on the server.** There's one parser, fixable without
  a client release, and no xz/zstd/PDF code in the React bundle. The browser
  only slices bytes and hashes.
- **Read budget: 7 MB, so a check fits in one 10 MB `express.json` body**
  (`READ_BUDGET`, ~9.4 MB as base64). The re-check after upload uses the same
  budget, so both reach the same verdict.
- **Reads follow each format's own pointers,** so their cost doesn't depend on
  file size. PDFs follow `startxref` → xref (`/Prev`, `/XRefStm`) → Info and
  XMP. A broken pointer falls back to a scan: the whole file up to 5 MB, else
  the first and last 1 MB.
- **A version edit on a draft isn't refused.** The affected files show
  `blockedBy`, and submit decides. A mistyped version doesn't trap the
  developer.
- **Publish doesn't re-check:** files can't change while in review.

## Measurements (2026-10-27)

- **Hashing in Edge** (headless, real files):
  - `.deb` 193 MB in 2.4 s;
  - `.exe` 212 MB in 3.1 s;
  - `.pkg` 505 MB in 7.1 s.

  That's ~70–80 MB/s, and the main thread was never blocked.
- **Bytes read per check:**

  | File | Bytes read |
  |---|---|
  | `.exe` | ~192 KB |
  | `.deb` | 64 KB, 1 GET |
  | `.pkg` | ~113 KB |
  | Release Notes PDF | 323 KB, 4 GETs |
  | User Guide PDF | 358 KB, 5 GETs |
- **OCI ranged GETs:** 54–344 ms each.

## Assumptions

- Staff use a current Chrome or Edge with module workers. If the worker can't
  start, the row fails with a readable error; the file is never uploaded
  unchecked.
- `zstd` comes from Node's `zlib` (Node 22.15+). xz uses the pure-JS
  `xz-decompress`. There are no native modules.

## Risks / follow-ups

- **Two people uploading the same installer to different releases within
  milliseconds can both get it in.** Accepted, because submit re-judges every
  file and blocks it then.
- **Dev only:** Vite needs its own `requestTimeout` raised (`vite.config.ts`,
  2 h). Otherwise uploads over 5 minutes lose their response while the API
  still saves the file. The client recovers by looking the file up by
  SHA-256. Production is unaffected (nginx and the API both allow 2 h).
- A refresh or navigation still cancels an upload in flight. This is planned
  in `tasks/resumable-uploads.md`, which replaces the single-request upload but
  keeps these checks.
