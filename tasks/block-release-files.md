# Task: block stale or duplicate release files before upload

**Status:** in progress. Phase 1 done (2026-10-26). Phase 2 done (2026-10-27): full server suite 746/746, lint and tsc clean, OpenAPI regenerated. Phase 3 done (2026-10-27): full server suite 768/768, lint, tsc and prettier clean, OpenAPI regenerated, OCI ranged-read smoke passed. Phase 4 done (2026-10-27): server 770/770 and client 137/137, lint, tsc and prettier clean, client build has a separate `sha256.worker` chunk (18 KB), OpenAPI regenerated. Phase 5 (measure, manual pass, docs) next. Phases 3 and 4 ship together.

**Phase 5 notes (in progress):**
- **5.1, hashing in headless Edge (real files from disk):**
  - `.deb` 193 MB in 2.4 s, `.exe` 212 MB in 3.1 s, `.pkg` 505 MB in 7.1 s, at about 70–80 MB/s;
  - the hashes match Node, and the main thread was never blocked;
  - this CPU has no SHA hardware acceleration (Node's native hash runs at 225 MB/s), and WASM can't use it anyway;
  - the hasher now reads the next chunk while hashing the current one.
- **5.2, `npm run storage:inspect-smoke` on real OCI:**
  - `.deb`: 1 GET, 64 KB, 0.3 s;
  - Release Notes: 4 GETs, 323 KB, 0.7 s;
  - User Guide: 5 GETs, 358 KB, 0.6 s;
  - uploading the `.deb` took 135 s.
- **Bug found in the 5.3 manual pass:** dev uploads longer than 5 minutes failed with "Can't reach the server" or "The server is unavailable" although the API saved them.
  - **Server log:** `request aborted` after 324 s; the API committed 3 s later.
  - **Stored bytes are fine:** the `.pkg` was verified identical by SHA-256 and by OCI's multipart MD5 `IWtcvA+wUnW9FzoBKaRpgw==-51`, recomputed locally.
  - **Cause:** the Vite dev server kept Node's default 300 s `requestTimeout`; the proxy timeouts didn't cover it.
  - **Fixes:**
    - `vite.config.ts` raises Vite's own `requestTimeout` to 2 h (verified: 7,200,000);
    - after a lost response, the client looks the file up by SHA-256 at 0, 2, 5 and 10 s and marks it uploaded if it landed;
    - a retry refused only as "same bytes in this release" also counts as uploaded.
  - **Production:** unaffected (nginx 7200 s, API `requestTimeout` 2 h). Noted in `docs/operations/release-storage.md`.

**Phase 4 notes:**
- **The editor pipeline** for each dropped file is: check versions (byte-range loop) → hash in a Web Worker (`hash-wasm`, 8 MiB chunks) → check with the hash → upload with `sha256`.
  - It shares the existing 2-file limit.
  - A blocked file never hashes or uploads.
  - `CHECKSUM_MISMATCH` forgets the hash, so Retry hashes again.
- **The server's `message` is shown** for blocks and warnings. `file-warnings.ts` is deleted.
- **Submit** first goes out without confirmation. On `FILE_WARNINGS_UNCONFIRMED`, `SubmitWarningsDialog` lists the files, and "Submit anyway" re-sends with `confirmWarnings`. The same flow runs in the editor and from the release page.
- **`FILE_BLOCKED` on submit** shows a toast naming the files, then the release is reloaded. In the editor, blocked saved files disable submit while the version is unchanged.
- **`sha256` is now required** on upload (400 "SHA-256 is required"). The test helpers send the body's hash.
- **Deviations:**
  - The submit dialog opens from the server's `FILE_WARNINGS_UNCONFIRMED` rather than being decided on the client, because warnings depend on the saved version.
  - `reportBlockedSubmit` lives in `pages/Releases/submit-errors.ts`, to keep fast refresh working.
  - **The headless Edge smoke test wasn't run.** It needs a signed-in dev account and a running server, and creating credentials isn't mine to do. It moves to the Phase 5 manual pass.

**Phase 3 notes:**
- **PDFs follow their own pointers** (`pdf-objects.ts`), with the scan as a fallback.
  - The reference PDFs now read 323 KB (4 round trips) and 358 KB (5) instead of 0.7 MB and 4 MB.
  - A 12 MB PDF in the tests reads under 512 KB.
- **`readRange`** is on both storage drivers. On the real bucket, ranged GETs take 54–344 ms each.
- **Upload:**
  - takes an optional `sha256` (required once Phase 4 sends it);
  - re-inspects the staged object and refuses with `FILE_BLOCKED` or `CHECKSUM_MISMATCH`, deleting the object;
  - stores `format` and `detectedVersions`.
- **Verdicts on read:** files of DRAFT, CHANGES_REQUESTED and IN_REVIEW releases get `blockedBy` and `warnings` (`releaseFileVerdicts`).
  - Files uploaded before inspection existed are inspected once from storage and saved; if that fails, the name alone is used and nothing is saved.
  - Shipped releases are never judged.
- **Submit:**
  - re-judges every file; a block refuses with `FILE_BLOCKED` and `details.files`;
  - warnings need `confirmWarnings: true`, else `FILE_WARNINGS_UNCONFIRMED`;
  - the `SUBMITTED` note lists the confirmed warnings.
- **Deviations:**
  - A version edit isn't refused; the files show `blockedBy` and submit refuses instead.
  - `file-warnings.service.ts` is deleted, and the file shape is now `format`, `detectedVersions`, `blockedBy` and `warnings`. Today's client breaks on this until Phase 4.
  - Test helpers default files to `format: OTHER` and the release version, and record a written object's real size.

**Phase 2 notes:**
- **Deviations from the plan:**
  - The read budget is 7 MB, not 16 MB, so a check fits in one 10 MB JSON body. PDFs are read whole up to 5 MB, otherwise the first and last 1 MB.
  - `translatePlatformConflict` became `translateUploadConflict`. It tells a duplicate-bytes P2002 from a platform P2002 by the row that exists.
  - `statusLabels` is now exported from `releases.errors.ts`.
- **Side fixes found by the first full run since the earlier migrations:**
  - **The rollback notifier is now tracked:** `startRollbackNotifications` and `rollbackNotificationsSettled`, awaited in `release-review.test.ts`.
  - **`hubspot.test.ts`** now expects the sign-up `useCase`.
  - **`vitest.config.ts` pins `maxWorkers: 1`:** Vitest 4 ignored `fileParallelism: false`, so files raced each other's `resetDb`. AGENTS.md is updated.

**Decided (2026-10-27):**
- **Rule 3 (`VERSION_EXISTS`) stays,** for its clearer message.
- **Installers identical to a rolled-back build are blocked.**
- **No task files are deleted yet,** `tasks/embedded-version-warnings.md` included.

**Supersedes:** `tasks/embedded-version-warnings.md` (advisory, read while streaming).

## Phase 4: detailed plan (client: check before upload, show verdicts, confirm warnings)

**Goal:** the editor checks every dropped file before uploading it, and shows the server's verdicts:
- blocked files never upload;
- warnings are visible on the row;
- submit asks "at your own risk" when files have warnings.

The server is already done (Phase 3). This phase consumes it, and makes the upload `sha256` field required.

### What changes for the developer
1. **The file is checked first.** Drop a file → the row shows "Checking…" (the version check takes under a second), then "Checking 42%" while the browser hashes it.
2. **Blocked:** the row turns red and lists the server's messages, for example:
   - "Identical to "emass-win.exe" in v1.134.0."
   - "This installer says version 1.134.0 (ProductVersion); this release is 1.135.0."

   It offers only **Remove**. Nothing is uploaded.
3. **Allowed:** the upload starts as today. Any warnings ("No version found…", or a doc of another version) show on the row in amber, and stay on the saved file afterwards.
4. **Saved files** show `blockedBy` in red (e.g. after the release version was changed) and `warnings` in amber, in the editor and on the release page.
5. **Send for review:**
   - files with warnings → a dialog lists them: "Check these files before submitting. Submit at your own risk." The developer clicks **Cancel** or **Submit anyway**;
   - a blocked file disables submit, with the reason in the checklist.

### 4.1 Model, mappers and API (`client/src/pages/Releases/`)
- **`releases.model.ts`:**
  - `FileIssue = { code; message; version?; fields?; expected?; match? }`.
  - `ReleaseFileItem` drops the old `warnings: FileWarning[]` shape and gains `format`, `detectedVersions`, `blockedBy: FileIssue[]` and `warnings: FileIssue[]`.
  - **The server's `message` is what's shown,** so wording lives in one place. **`file-warnings.ts` and its test are deleted.**
- **`releases.mappers.ts`:** `ApiFile` gets the new fields, and the old `toFileWarning` goes.
- **`releases.api.ts`:**
  - `checkFile(id, { name, size, sha256?, replace?, ranges })` → `{ status: "NEED_BYTES", ranges } | { status: "NEED_HASH" | "ALLOWED", format, versions, warnings }`;
  - `uploadFile` sends `sha256` (field order: kind, platform, replace, sha256, then the file);
  - `submit(id, { confirmWarnings? })`.
- **`releases.errors.ts`:** add `fileBlockedReasons(error)`, `blockedFiles(error)` (`details.files` from submit) and `unconfirmedWarnings(error)`, alongside the existing `platformTakenBy` / `highestShipped`.

### 4.2 Hashing in a Web Worker (`client/src/lib/hash/`)
- **Dependency:** `hash-wasm@4.12.0`. Pure WASM, no native code, about 12 KB for SHA-256.
- **`sha256.worker.ts`** (`new Worker(new URL("./sha256.worker.ts", import.meta.url), { type: "module" })`):
  - reads `file.slice()` in **8 MiB** chunks, feeding an incremental `createSHA256()`;
  - posts progress and then the hex digest;
  - memory stays at about one chunk.
- **`hash-file.ts`:** `hashFile(file, { onProgress, signal })` → `Promise<string>`.
  - One worker per file. An abort calls `worker.terminate()`.
  - The chunk loop is a pure `hashChunks(file, hasher, onProgress)` that the worker calls, so Node tests can use it directly.
- **Vite bundles the worker** as a separate chunk, loaded only when a file is dropped in the editor.

### 4.3 The check loop (`client/src/pages/ReleaseEditor/file-check.ts`)
- **`checkFile(api, releaseId, file, { replace, sha256, ranges })`:**
  - calls the endpoint;
  - on `NEED_BYTES`, reads exactly those `file.slice(offset, offset + length)` ranges, base64-encodes them (chunked, no `btoa` on huge strings) and calls again;
  - keeps the collected ranges, so the final call (with `sha256`) resends them without re-reading;
  - **gives up after 8 rounds** (`CHECK_RUNAWAY`), so a misbehaving server can't loop it;
  - **`FILE_BLOCKED`** comes back as the `ApiRequestError` with its `reasons`.

### 4.4 Upload queue (`upload-queue.ts`, `useUploadQueue.ts`)
- **New statuses:** `checking` (the version phase and the final check), `hashing` (with `hashed` bytes for progress), and `blocked` (terminal: Remove only).
  - The existing `conflict` (platform hold) still happens first, by file name, unchanged.
- **New `QueueItem` fields:** `sha256`, `hashed`, `blockedBy: FileIssue[]` and `warnings: FileIssue[]`.
- **One pipeline per item,** run by the existing runner within the **same 2-slot concurrency**: check versions → (blocked? stop) → hash → final check → upload with `sha256`. A queued file waits for a slot as today.
- **The runner takes injectable `check` and `hash` functions** (real ones by default from `useUploadQueue`), so tests run without a worker or the network.
- **Errors:**
  - **`FILE_BLOCKED`,** at either check or from the upload itself (a race) → `blocked`, with the reasons.
  - **`422 CHECKSUM_MISMATCH`** → `failed` ("The file changed while uploading. Retry."), and `sha256` is cleared so a retry hashes again.
  - **Other errors:** `failed`, as today. Retry resumes from the check, reusing a known `sha256`.
- **Cancel or dismiss while checking or hashing** aborts the request or terminates the worker.
- **Selectors:**
  - `isBusy` counts `checking` and `hashing` as active;
  - `overall` excludes `blocked` items;
  - **blocked rows don't block submit,** because they were never added to the release.

### 4.5 UI
- **`QueueRow.tsx`:**
  - the status text covers "Checking…", "Checking 42%" and "Uploading 37%";
  - a red **blocked** panel lists each reason's message, with a Remove button;
  - an amber line shows the check's warnings while the file uploads.
- **`StagedFileRow.tsx`:** `blockedBy` in a red list and `warnings` in an amber list, both using the server's messages. Replaces `fileWarningText`.
- **`EditRelease.tsx`:**
  - the upload toast uses `file.warnings[0].message`;
  - `submitBlocker` and the "Ready to submit?" checklist gain a step: "No blocked files" (fix the version or remove them).
- **New `pages/Releases/components/SubmitWarningsDialog.tsx`:** lists each file name with its warning messages, plus Cancel and **Submit anyway**. Used by both submit paths through a small `useSubmitRelease(release)` hook:
  - **saved files with warnings** → open the dialog first, then `submit({ confirmWarnings: true })`;
  - **server `FILE_WARNINGS_UNCONFIRMED`** (e.g. a pre-Phase-3 file inspected just now) → open the dialog from `details.files`;
  - **server `FILE_BLOCKED`** → a toast naming the files, then the release is reloaded.
- **Submit paths:** `EditRelease.submit()` and `ReleaseActions` (Submit on the release page).
- **`ReleaseDetailPage.tsx`:**
  - the old amber "looks like an earlier upload" callout becomes a **"Files with warnings"** callout and a red **"Blocked files"** callout, for draft, review and changes-requested releases;
  - the admin's review screen therefore sees the same warnings.
  - The `SUBMITTED` event note ("Submitted with warnings: …") already shows in Activity.

### 4.6 Server: make `sha256` required on upload
- **`uploadFieldsSchema.sha256`** becomes required ("SHA-256 is required" / "must be 64 hexadecimal characters").
- **The integration `upload()` helpers** in `release-files.test.ts` (and the raw-multipart helpers) send the body's hash by default. Add a test that a missing hash → 400.
- **OpenAPI:** `sha256` is required; then `npm run docs`.

### 4.7 Tests
- **`upload-queue.test.ts`** (fake `check`, `hash` and `upload`):
  - the order check → hash → check → upload, with `sha256` passed;
  - a version block never hashes or uploads;
  - a final-check block never uploads;
  - an upload `FILE_BLOCKED` → `blocked`;
  - `CHECKSUM_MISMATCH` → `failed`, and a retry hashes again;
  - the 2-slot limit counts checking and hashing;
  - a cancel while hashing aborts it;
  - dismissing a blocked row removes it.
- **`file-check.test.ts`:**
  - ranges are accumulated and resent;
  - the base64 of a slice equals Node's;
  - the runaway guard;
  - `FILE_BLOCKED` reasons come through.
- **`hash-file.test.ts`:** `hashChunks` over a multi-chunk `Blob` equals Node `crypto` SHA-256, with progress reaching the size.
- **Updates:**
  - `releases.api.test.ts`: `checkFile` and `submit` bodies, and the upload's `sha256` field order;
  - `releases.mappers.test.ts`: the new file fields;
  - `editor.state.test.ts`: the blocked-file submit blocker.
- **Server:** the 4.6 test, then the full suite.

### 4.8 Done when
- **Client:** `tsc -b`, eslint, vitest and `vite build` all green, and the build output has a separate worker chunk.
- **Server:** the full suite is green, and lint, tsc and prettier are clean. OpenAPI is regenerated.
- **A headless Edge smoke test** of the editor:
  - drop a small PE fixture into a matching draft → it uploads;
  - drop a mismatching one → it's blocked;
  - check the submit dialog.

  (The real 600 MB timing and the manual pass are Phase 5.)
- `tasks/block-release-files.md` is updated, then I stop for your review.

### Risks / notes
- **Hash speed:** `hash-wasm` SHA-256 runs at roughly 300–600 MB/s, about 1–2 s for 600 MB, bounded by disk reads. Phase 5 measures it on the real `.pkg`.
- **A file edited on disk** between the hash and the upload → the server's `CHECKSUM_MISMATCH` catches it, and Retry re-hashes.
- **Old browsers without module workers:** not supported (staff use current Edge or Chrome). If `Worker` fails to start, the row fails with a readable error rather than uploading unchecked.

## Amendment (before Phase 3): is the 7 MB read limit enough?

**Short answer:** yes for installers, but **PDFs are the only thing the limit affects**, and raising it is the wrong fix.

**What each format actually reads today** (measured on the reference files):

| Format | Bytes read | Depends on file size? |
|---|---|---|
| `.exe` (222 MB) | 192 KB | No: follows PE pointers |
| `.deb` (200 MB) | 64 KB | No: control archive is the 2nd member |
| `.pkg` (530 MB) | 113 KB | No: TOC + two small files |
| PDF | **whole file** (≤ 5 MB), else first + last 1 MB | **Yes**: the PDF parser scans instead of following pointers |

- **Installers** use under 3% of the 7 MB budget. Even unusual installers (large version resource, big control archive) stay far below it. 16 MB would change nothing for them.
- **PDFs:** raising the limit to 16 MB (and the request to 20 MB) would only help PDFs between 5 and 12 MB. The cost: the browser uploads the **whole PDF as base64 JSON twice** (version phase, then the final check), so up to ~42 MB of traffic per doc. A 30 MB manual would still fall back to the ends.

**Recommendation:** keep the 7 MB budget and the 10 MB request limit. Make the PDF parser **follow the PDF's own pointers** like the other formats, so a PDF of any size costs about the same few hundred KB:
1. Read the last 1 KB, then `startxref` → cross-reference section (classic table, or compressed xref stream).
2. Follow `/Prev` and `/XRefStm` so newer revisions win, as in Word's hybrid files like ours.
3. Trailer `/Info` → the object's offset → read that object. If it sits in an object stream, read and inflate that stream.
4. Trailer `/Root` → catalog `/Metadata` → the XMP stream (inflate if compressed).
5. **Fallback:** if any pointer is broken or missing, use today's scan (whole file if ≤ 5 MB, else both ends). A broken xref alone isn't "damaged"; readers repair those.

**Expected result:** the reference PDFs drop from 0.7 MB and 4 MB reads to roughly 100–300 KB in 4–6 round trips, independent of PDF size.

**Changes:**
- `server/src/services/releases/file-inspect/pdf.ts`: structural path first, the existing scan as fallback.
- **Tests:**
  - classic xref, xref stream with an object stream, an incremental update (`/Prev`), a large PDF (> 5 MB of padding) whose Info is still found, and a broken `startxref` (fallback);
  - the reference test records bytes read for both PDFs.
- No API, schema or limit changes. **The task file and docs** note that read cost is independent of file size for every parsed format.

**Verification:**
- Unit + reference tests, and the full server suite.
- Re-run the scratchpad smoke script and record bytes read and round trips per reference file.

---

## Phase 3: detailed plan (server enforcement on upload, edit and submit)

**Goal:** the server enforces the rules itself.
- An upload can't add a file the check would block, even from a modified client.
- Files already in a draft are re-judged when the release version changes.
- Submit refuses blocked files and requires an explicit "at your own risk" for warnings.

**First, an open-questions sweep:** the plan file and task file get the decided answers above (rule 3 kept, rolled-back blocked, no task deletions).

### 3.0 PDF structural reader (the amendment above)
- **`file-inspect/pdf.ts`:** follow `startxref` → xref (table or stream, with `/Prev` and `/XRefStm`) → `/Info` and `/Root /Metadata`, inflating object streams.
- **Fallback:** today's scan when a pointer is broken.
- **Budget and request limit unchanged** (7 MB / 10 MB).

### 3.1 Ranged reads from storage
- **`StorageDriver.readRange(bucket, key, offset, length): Promise<Uint8Array>`:**
  - **OCI:** `getObject` with `range: "bytes=a-b"`, the stream collected to a buffer;
  - **local:** `fs.open` + `read`.
  - A missing object throws `SOURCE_NOT_FOUND`, as `copyObject` does.
- **`storageReader(bucket, key, size)`** in `file-checks.service.ts`: a `blockReader` whose loader calls `readRange` per range (64 KiB blocks, same budget).
- **Smoke:** `npm run storage:smoke` gains a ranged-read step against the real bucket.

### 3.2 Upload enforcement (`release-files.service.ts` → `uploadReleaseFile`)
1. **New optional multipart field `sha256`,** sent before the file part, in the `uploadFieldsSchema` (64 hex characters).
   - **Optional in Phase 3** so today's client keeps working; Phase 4 sends it, and makes it required at the end of Phase 4.
2. **After the stream ends, before the row is inserted:**
   - a declared hash that differs from the computed one → `422 CHECKSUM_MISMATCH`, and the staged object is deleted;
   - `inspectFile(storageReader(staging, key, bytes), name)`, then `fileFacts(release, inspection, sha256, fields.replace)`, then `evaluateFile`;
   - any reason → `409 FILE_BLOCKED` (the same body as the check endpoint), and the object is deleted.
3. **The row stores `format` and `detectedVersions`** (unique versions).
4. **The response** `file` carries the new `warnings`.
5. **Race within one release:** still caught by `@@unique([releaseId, sha256])` and `translateUploadConflict`.
6. **Race across releases** (two people uploading the same installer within milliseconds): accepted. Submit re-checks it (3.4).

### 3.3 Verdicts for stored files (replacing `file-warnings.service.ts`)
- **`releaseFileVerdicts(release, files)`** in `file-checks.service.ts`: for every file, `{ reasons, warnings }` from its stored `format` + `detectedVersions` + `sha256`.
  - **Two queries per release:** same-sha files elsewhere, and other releases at the claimed versions.
  - It reuses `evaluateFile`.
- **Messages without fields:** stored versions keep no field names, so `evaluateFile` drops the "(…)" part when `fields` is empty. For example: "This installer says version 1.134.0; this release is 1.135.0."
- **Legacy rows** (`format` null, uploaded before Phase 3):
  - Inspected once from storage on the first verdict that needs them (detail read, version edit, submit), and `format`/`detectedVersions` backfilled.
  - If the object can't be read, the file is judged by its name only and the error is logged.
- **Presenter:** `presentFile(file, verdict)` returns `warnings` (the new shapes) and `blockedBy` (reasons).
  - `getRelease` and the upload response use `releaseFileVerdicts`.
- **`file-warnings.service.ts` is deleted.** Its integration tests in `release-files.test.ts` are rewritten to the new behaviour.

### 3.4 Version edit and submit
- **`PATCH /releases/:id` with a new version is allowed** (no hard refusal, so a dev who mistyped the version isn't trapped). The detail response then shows the affected installers under `blockedBy`.
  - *This deviates from the earlier "refuse the edit" wording; deciding at submit is simpler.*
- **`POST /releases/:id/submit`** takes the body `{ confirmWarnings?: boolean }` (new `submitReleaseSchema`). Inside the existing transaction, after `assertReadyForReview`, the verdicts are re-run:
  - **any file blocked** → `409 FILE_BLOCKED` with `details.files[] { fileId, name, reasons }`;
  - **warnings and no `confirmWarnings: true`** → `409 FILE_WARNINGS_UNCONFIRMED` with `details.files[] { fileId, name, warnings }`;
  - **confirmed** → the `SUBMITTED` event note reads "Submitted with warnings: guide.pdf: No version found…; …", so the admin sees it in Activity.
- **Publish doesn't re-check;** the files can't change while in review.

### 3.5 OpenAPI and errors
- **Error helpers** in `releases.errors.ts`: `checksumMismatch()` (422) and `fileWarningsUnconfirmed(files)` (409).
- **OpenAPI:**
  - upload: the `sha256` field and the 409/422 responses;
  - submit: the body and the 409s;
  - file shape: `warnings` and `blockedBy`.
- Then `npm run docs`.

### 3.6 Tests
- **Test helpers:** `createRelease` files default to `format: "OTHER"` and `detectedVersions: [release version]`, and a name containing the version. Existing workflow tests then carry no warnings.
- **Unit:**
  - the local driver `readRange` (bounds, missing object), and the OCI driver `readRange` (mocked client, the `Range` header);
  - `evaluateFile` with empty fields;
  - the PDF structural cases from 3.0.
- **Integration, uploads:**
  - a wrong declared hash → 422 and no object left;
  - an installer with the wrong version → 409 and no object left;
  - an installer identical to another release's file → 409;
  - a doc with another version → 201 with a warning;
  - `format`/`detectedVersions` are stored.
- **Integration, release detail:** `blockedBy` after a version edit; a legacy null-format file is backfilled from storage.
- **Integration, submit:**
  - a blocked installer → `FILE_BLOCKED`;
  - warnings → `FILE_WARNINGS_UNCONFIRMED`;
  - `confirmWarnings: true` → `IN_REVIEW`, with the note on `SUBMITTED`;
  - another DEV still gets 403.

### 3.7 Known gap until Phase 4
- **Today's client:**
  - it doesn't send `confirmWarnings`, so submitting a draft with warnings fails with a readable 409 until Phase 4 adds the dialog;
  - it reads the old warning codes (`SAME_CONTENT` / `NAME_VERSION_MISMATCH`) from file rows. Phase 4 replaces those mappers.
- **So Phases 3 and 4 ship together.**

### 3.8 Done when
- The full server suite is green.
- Lint, both `tsc` configs and prettier are clean.
- OpenAPI is regenerated and the OCI ranged-read smoke run passes.
- `tasks/block-release-files.md` is updated (Phase 3 done, deviations noted).
- Then I stop for your review.

## Phase 2: detailed plan (rules, schema, check endpoint)
**Goal:** `POST /api/releases/:id/files/check` gives the final verdict for a file **before** any upload, using the Phase 1 parser and the DB. Uploads aren't changed yet (Phase 3), except for the new uniqueness rule.

### 2.1 Schema + migration (⏸ you run it)
- **`prisma/schema.prisma`:**
  - new `enum ReleaseFileFormat { PE DEB PKG PDF OTHER }`;
  - on `ReleaseFile`:
    - `format ReleaseFileFormat?`: null for files uploaded before this change;
    - `detectedVersions String[] @default([])`;
    - `@@unique([releaseId, sha256])`. The existing `@@index([sha256])` stays.
- **Hand-written `prisma/migrations/20261027120000_release_file_checks/migration.sql`:**
  - create the enum and add the two columns;
  - a `DO $$ … RAISE EXCEPTION` guard that stops with a readable message ("release X has the same file twice: …") if any existing release already holds duplicate bytes, so dev data can be cleaned first;
  - create the unique index.
- **⏸ You run `npx prisma migrate dev` and `npm run test:migrate`.** I don't run migrations.

### 2.2 Shrink the read budget so a check fits in one request
- `READ_BUDGET` 16 MB → **7 MB**, and the PDF limits: read whole up to **5 MB**, otherwise the first and last **1 MB**.
- **Why:** the browser sends the bytes as base64 JSON. 7 MB of bytes is about 9.4 MB of JSON, under the existing 10 MB `express.json` limit, so no new body parser is needed.
- **The same budget applies** to the server's post-upload re-check in Phase 3, so both checks always reach the same verdict.
- Every reference file still fits: the biggest read is the 4 MB User Guide. The unit tests are updated.

### 2.3 Pure rules: `src/services/releases/file-checks.utils.ts`
`evaluateFile({ releaseVersion, inspection, sameRelease, otherRelease, productVersions })` → `{ reasons, warnings }`. It's pure and unit-tested.
- **Installers** (format PE/DEB/PKG):
  - `SAME_CONTENT`: identical bytes in this release, or in any other release (rolled-back ones included).
  - For each detected version that isn't the release version:
    - `VERSION_EXISTS` if another release of the product has that version, naming its status;
    - otherwise `VERSION_MISMATCH`.
- **Docs and everything else** (PDF, OTHER):
  - `SAME_CONTENT` only within this release;
  - a version that differs gives the warning `DOC_VERSION_MISMATCH`.
- **All files:**
  - `DAMAGED` (from the parser) blocks;
  - no versions at all gives the warning `NO_VERSION`.
- **Each reason and warning** carries `code`, a readable `message`, and the fields the UI needs (`version`, `fields[]`, and the `match {fileId, fileName, releaseId, version, status}`). One entry per distinct version; the fields that claim it are listed together.
- **Example messages:**
  - "Identical to *emass-win.exe* in v1.134.0."
  - "Already in this release as *User-Guide.pdf*."
  - "This installer says version 1.134.0 (ProductVersion); this release is 1.135.0."
  - "This installer says version 1.134.0, which already exists (published)."
  - "This file says version 1.4.0 (file name, Info Subject); this release is 1.135.0."
  - "No version found in this file's name or contents."

### 2.4 Service: `src/services/releases/file-checks.service.ts`
`checkReleaseFile(devId, releaseId, input)`:
1. **Load and authorise** the release: the creating DEV and `EDITABLE_STATUSES`, with the same errors as upload (`RELEASE_NOT_FOUND`, `NOT_RELEASE_OWNER`, `RELEASE_LOCKED`). `replace`, if given, must be a file of this release.
2. **Run `inspectFile(suppliedReader(size, ranges), name)`.** On `NeedBytes`, return `{ status: "NEED_BYTES", ranges }`.
3. **DB facts, two indexed queries:**
   - files with this `sha256` (excluding `replace`);
   - the product's other releases whose version is among the detected versions.
4. **`evaluateFile`.**
   - **Any reason:** `409 FILE_BLOCKED`, with `details { reasons, format, versions }`.
   - **No `sha256` yet:** the content checks are skipped and the result is `{ status: "NEED_HASH", format, versions, warnings }`. This is the fail-fast version phase, before the browser hashes.
   - **Otherwise:** `{ status: "ALLOWED", format, versions, warnings }`.

The service is **stateless**: each call re-parses from the ranges it's sent.

### 2.5 Route, schema, controller
- **`src/schemas/release-files.schema.ts`:** `fileCheckSchema`:
  - `name`: 1–255 characters, the same rules as `uploadFileNameSchema`;
  - `size`: an int from 1 to `MAX_UPLOAD_BYTES`;
  - `sha256`: optional, 64 hex characters;
  - `replace`: an optional guid;
  - `ranges`: an array of `{ offset, data }`, where `offset` is a multiple of 64 KB and `data` is base64. The total decoded size is ≤ 7 MB (else 400 `RANGES_TOO_LARGE`) and each range lies within `size`.
  - Every required field gets separate missing and wrong-type messages (the zod-schemas skill).
- **Controller:** `check` in `release-files.controller.ts`, reusing the controller's existing `releaseId()` helper.
- **Route:** `router.post("/:id/files/check", dev, checkFile)` in `releases.routes.ts`.
- **OpenAPI:** the path in `scripts/openapi-releases.ts`; run `npm run docs`.

### 2.6 The new uniqueness rule on today's upload
- **A second identical file in one release** now hits the `(releaseId, sha256)` index.
- **Translate that P2002** in `release-files.service.ts`, next to `translatePlatformConflict`: return `409 FILE_BLOCKED` with a `SAME_CONTENT` reason, and delete the orphaned object (the catch already does this).
- **Replacing a file with identical bytes** still works: the old row is deleted first, in the same transaction.
- **The existing integration test** "warns about the same bytes twice in one release" changes to expect that 409.

### 2.7 Tests
- **Unit, `tests/unit/file-checks.utils.test.ts`:** every rule for an installer vs a doc, `VERSION_EXISTS` vs `VERSION_MISMATCH`, grouping by version, `NO_VERSION`, `DAMAGED`, and the no-hash phase.
- **Integration, `tests/integration/release-file-checks.test.ts`** (`beforeAll(resetDb)`; synthetic files from `tests/helpers/file-fixtures.ts`):
  - **the range loop:** an empty first call → `NEED_BYTES` → resend → `NEED_HASH` → with `sha256` → `ALLOWED`;
  - **installer blocks:** the same bytes in another release (including a rolled-back one), a wrong version, a version that exists;
  - **docs:** the same bytes as another release are allowed; a version mismatch is a warning; the same bytes in this release are blocked;
  - **damaged files** are blocked;
  - **`replace`** excludes the file it replaces;
  - **schema errors:** missing or wrong-type fields, misaligned or oversized ranges;
  - **access:** another DEV → 403, an admin or a customer → 403, a release that isn't editable → 409, an unknown release → 404.
- **Upload:** a duplicate inside one release → 409, and the staged object deleted.

### 2.8 Done when
- The server suite passes: `npx dotenv -e .env.test -- vitest run`.
- `tsc` (both configs), eslint and prettier are clean.
- OpenAPI is regenerated.
- The task file is updated, and I stop for your review.

## Phases
**Open questions:** none; see Decided above.

### Phase 1: the file parser (server only, pure, no DB)
- **New folder `server/src/services/releases/file-inspect/`:**
  - `range-reader.ts`: the `RangeReader` type, a buffer/ranges reader that throws `NeedBytes(offset, length)`, and the 16 MB budget;
  - `detect-format.ts`: format detection from the first bytes;
  - `name-version.ts`: the file-name parser, which replaces the logic in `file-warnings.service.ts` and ignores hashes and dates;
  - `semver.ts`: `normalizeSemver`;
  - `pe.ts`, `deb.ts`, `xar.ts`, `pdf.ts`;
  - `inspect.ts`: `inspectFile(reader, name)` → `{ format, versions, damaged? }`.
- **Dependencies:**
  - **xz:** a pure-JS decoder;
  - **zstd:** Node's `zlib.zstdDecompressSync` (Node 22.15+, and we're on 22.17); `fzstd` only if the VM's Node is older.
- **Tests:**
  - `tests/unit/file-inspect/*.test.ts`, with synthetic buffers for each format, damaged cases, and xar metadata at both the start and the end;
  - the opt-in reference-files test.
- **Done when:** the reference files give deb, pkg and exe → 1.135.0, Release Notes → {5.0.0, 1.135.1}, User Guide → {1.4.0}.
- **No migration needed.**

### Phase 2: rules, schema and the check endpoint
- **Schema:**
  - `ReleaseFile.format` (enum), `detectedVersions String[]`, `@@unique([releaseId, sha256])`;
  - hand-written migration SQL that first lists any duplicate `(releaseId, sha256)` rows;
  - **⏸ you run `prisma migrate dev` + `npm run test:migrate`.**
- **`file-rules.service.ts`:** the installer and doc rules (`SAME_CONTENT`, `VERSION_MISMATCH`, `VERSION_EXISTS`, `DAMAGED`; warnings `NO_VERSION`, `DOC_VERSION_MISMATCH`), with readable messages.
- **`POST /api/releases/:id/files/check`:**
  - schema, controller and route;
  - creating DEV only, editable states;
  - the range loop (`need` / allowed / `409 FILE_BLOCKED`).
- **Tests:** integration tests for every outcome, the 16 MB cap, and cross-user access refused.

### Phase 3: server enforcement on upload and submit
- **`StorageDriver.readRange`** (OCI `GetObject` with `Range`; local fs) and a storage-backed `RangeReader`.
- **`uploadReleaseFile`:**
  - a `sha256` field (declared ≠ computed → 422);
  - re-inspect the staged object and re-run the rules (delete the object on a block);
  - store `format` and `detectedVersions`.
- **A draft version edit and submit** re-run the rules on stored files; submit requires `confirmWarnings`, recorded on the `SUBMITTED` event.
- **Replace the advisory warnings:** remove `file-warnings.service.ts`, so the presenter returns the new stored warnings.
- **Tests:** integration tests for these, plus an OCI ranged-read smoke run against the real bucket.

### Phase 4: client
- **`hash.worker.ts`:** `hash-wasm`, 8 MB slices, with progress.
- **`upload-queue.ts` / `useUploadQueue.ts`:**
  - a "checking" stage, the range loop, then the hash and the final check;
  - upload only when allowed, sending `sha256`.
- **UI:**
  - `QueueRow`: a blocked state with the reason and Remove;
  - `StagedFileRow` and the review screen: warnings;
  - the submit dialog listing the warnings.
- **Replace the old warning mappers and tests** (`releases.mappers.ts`, `file-warnings.test.ts`).
- **Tests:** vitest for the queue (a blocked file never uploads) and the worker hash.

### Phase 5: measure, manual pass, docs
- **Benchmark:**
  - hashing time and memory for the 600 MB `.pkg` in Edge;
  - round trips and bytes read per format;
  - server-side `readRange` on OCI.
- **The manual pass** from Verification below.
- **Docs:**
  - convert this task into `server/docs/releases/` (blocking rules and file authoring), update `release-management.md` and `architecture.md` (new dependencies), regenerate OpenAPI;
  - update the AGENTS.md checksum line if needed;
  - keep both task files until you say they can go.

## Context
**Today:** duplicates and stale versions only produce *warnings*, after a 100–600 MB upload has finished.

**New rules:** checked **before the upload starts**, with **no override** for the blocks.

**Installers** (`.exe`, `.deb`, `.pkg`, recognised by their first bytes, so renaming or re-mapping can't dodge the rule):
1. **Duplicate bytes:** the SHA-256 matches any existing release file → **blocked**.
2. **Wrong version:** any version in the name or inside the file, normalised to semver, differs from the release version → **blocked**.
3. **Old version:** a detected version already exists for this product → **blocked**, with its own message.

**Docs** (PDF, and every format we don't parse, such as zip, md, txt):
- **No checksum check across releases.** Re-attaching last release's User Guide is normal, whether it's the identical file or a re-export with a new checksum.
- **A version mismatch is a warning, not a block:** "This file says version 1.4.0; this release is 1.135.0." The developer may intend to ship an old doc.
- **Still blocked:** the same bytes twice **in the same release** (`@@unique([releaseId, sha256])`), and damaged files.

**Why no checksum check for docs:** the only thing it can catch is an identical file, which is exactly the legitimate "keep last release's doc" case. A re-exported PDF gets new bytes and would slip past it anyway. For docs it would block the good case and miss nothing harmful, so we drop it.

## 1. How we read the version inside a file
**We never rely on fixed byte positions.** Every one of these formats starts with a header at **byte 0** that says where everything else is. We read the header, follow its pointers, and read only the few KB they point to. That's how the operating system's own tools read these files, so it works for any valid file of that format, wherever its parts happen to sit.

| Format (recognised by its first bytes, not the extension) | What the header tells us | Where the version is | Fixed by the format spec? |
|---|---|---|---|
| **Windows `.exe`** (`MZ`) | byte 60 → PE header → section table → resource table | the `VERSIONINFO` resource (FileVersion / ProductVersion) | **Yes.** It's how Windows Explorer shows "Properties → Details". It was ~1 MB in for us, but we find it by following the pointers, wherever it is. |
| **Linux `.deb`** (`!<arch>`) | an ar archive: a list of members, each with its size | `control.tar.{gz,xz,zst}` → `control` → `Version:` | **Yes.** dpkg requires `control.tar` to be the **2nd member**, so it's always in the first few KB. |
| **macOS `.pkg`** (`xar!`) | header + a compressed **table of contents** at the start that lists every file with its offset and length | `PackageInfo` (`pkg-info version=`) and `Distribution` (`pkg-ref version=`) | **The table of contents is fixed; the files' positions are not.** They were at the **end** of our file only because Apple's `productbuild` writes them after the payload. Another build tool could put them first. We don't care either way: we look up the offset in the table of contents and read there. |
| **PDF** (`%PDF`) | a trailer at the **end** (`startxref`, always in the last ~1 KB) → cross-reference table → the Info object | Info `Subject` / `Title`, and the XMP metadata | **Yes, but PDFs are messier:** newer PDFs compress the cross-reference table and objects, and edited PDFs append updates. The parser follows the trailer chain and inflates compressed parts. Docs are a few MB, so reading more of them costs nothing. |
| zip, tar.gz, dmg, anything else | — | **file name only** | — |

**What if a file isn't as expected?** Every file ends in one of four outcomes:
1. **Version found** (in the name, inside the file, or both) → the rules apply to every version found.
2. **Damaged** → **blocked**, with the specific reason. This applies only when the damage is certain: the first bytes say "I'm a `.deb`/`.exe`/`.pkg`/PDF" but the structure breaks the format's own rules. For example:
   - "Not a valid .deb: the control archive is missing";
   - "Not a valid installer: the PE header points past the end of the file";
   - "Not a valid .pkg: the table of contents can't be decompressed".

   **Unusual but valid** is never "damaged":
   - an `.exe` with no version resource, or a PDF with no Subject, is outcome 3;
   - a format we don't parse (zip, dmg, tar.gz) is never "damaged".
3. **No version anywhere** (not in the name, not inside the file) → **allowed, with a warning**: "No version found in this file."
4. **A doc whose version doesn't match** → **allowed, with a warning** (see the rules above).

**Warnings on submit:** on **Submit for review**, one dialog lists every file with a warning (no version, or a doc with a different version): "Check these files before submitting. Submit at your own risk." The developer clicks Cancel or Submit anyway.
- **The server enforces it:** submit takes `confirmWarnings: true` and refuses `409 FILE_WARNINGS_UNCONFIRMED` without it.
- **The confirmation is recorded** in the `SUBMITTED` event, so the admin sees it in Activity.
- **The admin's review screen** shows the same warnings on those files.

The parser reads at most **16 MB per file** in total and never loops. If it can't decide within that budget, it's treated as outcome 3 (a warning, not a block), because we can't be **sure** the file is damaged.

**Reference files today:**
- **deb, pkg and exe** → 1.135.0: they pass in a 1.135.0 release.
- **Release Notes** → name 5.0, Subject 1.135.1: **allowed, with a warning.**
- **User Guide** → 1.4: **allowed, with a warning**, even as the identical file from the last release.


## 2. The architecture in plain words
**Key idea:** the parser lives **only on the server.** The browser never interprets the file. It just hands over the small byte ranges the server asks for, and hashes the file.

**When the developer drops a file:**
1. **The row appears as "Checking…".** Nothing is uploaded. A browser `File` is a pointer to the file on disk; `file.slice(a, b)` reads only those bytes, so nothing big enters memory.
2. **Read versions (well under a second).** The browser calls `POST /api/releases/:id/files/check` with `{ name, size }`.
   - The server starts parsing and answers: "send me bytes 0–4 KB".
   - The browser slices those bytes and sends them back. The server follows the pointers and asks for the next range.
   - This takes **2–5 small round trips, a few KB in total**, until the server has the versions.
   - **If an installer breaks rule 2 or 3, or any file is damaged,** the server answers **blocked**, and the row turns red at once with the reason. We don't even hash.
   - **Doc version mismatches** come back as a warning instead, and the flow continues.
3. **Hash (a few seconds for 600 MB).** A Web Worker reads the file from disk 8 MB at a time and feeds an incremental SHA-256 (`hash-wasm`).
   - Memory stays flat; the page stays responsive.
   - The row shows "Checking… 42%".
4. **Final check.** The browser calls the same endpoint with `{ name, size, sha256, ranges }`, the ranges it already collected. The server keeps no state between calls, so it re-parses from those bytes and runs all the rules for that file type.
   - **Blocked:** the row shows the reason, and the developer can only remove the row. For example:
     - "Identical to *emass-win.exe* in v1.134.0";
     - "This installer says version 1.134.0; this release is 1.135.0";
     - "Already in this release as *User-Guide.pdf*".
   - **Allowed:** the response is `{ allowed: true, warnings }`, and any warnings show on the row.
5. **Upload.** It runs exactly as today, the same multipart stream to OCI, two at a time, with one extra form field: `sha256`.
6. **The server double-checks while and after receiving the upload** (a modified client can't skip the checks):
   - **Hash:** it already computes SHA-256 while streaming. If that differs from the declared hash → `422 CHECKSUM_MISMATCH`.
   - **Versions:** it runs the **same parser** against the staged object, using OCI ranged reads (a few KB).
   - **Duplicates:** it re-checks against the DB. For an installer, that covers every release; for a doc, only this one. `@@unique([releaseId, sha256])` handles a race within a release.
   - **On any failure,** the staged object is deleted and nothing is recorded.

   For an honest client this step never fails, because step 4 already passed.

**Why this shape:**
- **One parser, in one place, fixable without a client release.**
- **No xz/zstd/PDF code in the React bundle.**
- **Fail-fast before hashing,** so a wrong version is reported in under a second.
- **The same code checks the bytes before the upload and the stored object after it.**

## 3. Builds and deploy: no shared folder
- **Client:** builds as today (`tsc -b && vite build`).
  - **Added:** the `hash-wasm` dependency and one worker file (`new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" })`). Vite bundles that worker as a separate small chunk, loaded only on the release editor.
  - **Added:** one small loop in `upload-queue.ts` that answers the server's byte-range requests.
- **Server:** builds and deploys as today (`tsc -p tsconfig.build.json` → `node dist/server.js`).
  - **New:** a parser under `src/services/releases/file-inspect/` (pe, deb, xar, pdf and name parsers, plus `normalizeSemver`).
  - **New dependencies:** a pure-JS xz decoder; zstd from Node's `zlib` if our Node version has it, otherwise `fzstd`. No native modules, so nothing changes on the VM.

## 4. Server changes (summary)
- **`POST /releases/:id/files/check`:**
  - creating DEV only, editable states;
  - Zod schema;
  - `ranges` are base64, capped at 16 MB in total;
  - answers `{ need: [{offset, length}] }`, `{ allowed: true, versions, warnings }` (warnings `NO_VERSION | DOC_VERSION_MISMATCH`), or `409 FILE_BLOCKED` with `details.reasons[]` (`SAME_CONTENT | VERSION_MISMATCH | VERSION_EXISTS | DAMAGED`, each with a readable `message`);
  - the file type comes from the parser (first bytes), not from the developer's kind mapping.
- **Submit:** `confirmWarnings: true` (§1, warnings on submit).
- **`RangeReader` interface (`{ size, read(offset, length) }`)** with three implementations:
  - from the request's ranges (it throws "need bytes" when one is missing);
  - from the staged OCI object (`StorageDriver.readRange`, an OCI `GetObject` with a `Range` header);
  - from the local fs.
- **Upload:** a `sha256` form field, plus the post-upload checks in step 6 above.
- **Schema (migration; you run it):**
  - `@@unique([releaseId, sha256])`; the existing `@@index([sha256])` is kept for the installers' cross-release lookup;
  - `ReleaseFile.detectedVersions String[]` and `ReleaseFile.format` (`PE | DEB | PKG | PDF | OTHER`). With these, a draft's version edit and submit re-run the rules on files already uploaded: an installer that no longer matches blocks submit; a doc that no longer matches becomes a warning.
- **Remove the advisory warnings** (`file-warnings.service.ts` and the UI callouts).

## Tests
- **Unit:**
  - synthetic PE, deb (gz/xz/zst), xar (metadata at the start **and** at the end) and PDF (plain, compressed cross-reference table, incremental update) buffers;
  - broken-structure cases;
  - `normalizeSemver` and the file-name parser (commit hashes, dates).
- **Opt-in:** a reference-files test against `.tmp/reference-files`, only when that folder is present.
- **Integration:**
  - the check endpoint: the range loop, each block, allowed, the 16 MB cap, and cross-user access refused;
  - the upload: a declared hash that doesn't match → 422 and the object deleted; a duplicate race → one row; a post-upload version block.
- **Client:** the queue never uploads a blocked file; the worker's hash equals Node's.

## Verification
- Run the server tests (after the migration), lint, then the client's tsc, eslint, vitest and build.
- **Manually, in a 1.135.0 draft:**
  - the three installers pass;
  - both PDFs upload with a version warning, and submit shows the confirmation dialog;
  - the same `.exe` dropped into another release is blocked; the same PDF dropped into another release is allowed;
  - the same PDF dropped twice into one release is blocked;
  - the network tab shows no large request for any blocked file.
- **Measure** the hashing time for 600 MB and the number of round trips per format, and record both in the release-management doc.

## Decided
- **Damaged** (certain only) → blocked, with the reason.
- **No version anywhere** → a warning, plus a server-enforced "at your own risk" confirmation on submit.
- **No carry-forward feature:** old docs are simply re-uploaded.
- **Docs:** no cross-release checksum check, and a version mismatch is a warning. Only a duplicate within the same release, or a damaged file, blocks them.
- **Installers:** all three rules are hard blocks.

