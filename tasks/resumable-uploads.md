# Task: resumable uploads with pause/resume and a global upload panel

**Status:** planned, not started (2026-10-27). To be refined before implementation. Updated 2026-10-27: publish progress for admins in the same panel (6.3b).

**Related:** `server/docs/releases/file-checks.md` (the shipped file checks this builds on). This task replaces the single-request upload added there; the checks (version check, hash, final check, server re-inspection, file rules) stay as they are.

## Context
- **The manual pass now works end to end:** the 505 MB `.pkg` uploads without errors after the Vite timeout fix.
- **What's left:** a page refresh (or any unexpected reload) cancels the file being uploaded, and leaving the editor cancels uploads too.
- **The goal:** uploads that survive refreshes, navigation, network drops and server restarts, with pause, resume and cancel from a bottom-right panel on every staff page.
- **Admins:** see their publish copies in the same panel (added 2026-10-27).

**Your decisions (2026-10-27):**
- **After a refresh:** Chrome and Edge resume with one click, using a stored file handle; Firefox and Safari ask you to pick the file again.
- **One upload path:** the piece-by-piece protocol **replaces** today's single-request upload.
- **The panel is on every staff page;** uploads keep going when you leave the editor.

**Hard limits (browser rules):**
- An open HTTP request never survives a refresh.
- After a refresh, reading a file again needs either a stored file handle (Chromium only), re-confirmed with **one click** (the permission needs a user gesture), or the user picking the file again.
- Everything else resumes **automatically** while the page is open: network blips, server restarts and the laptop sleeping.

## 6.1 Server: resumable upload sessions (one path; replaces `POST /releases/:id/files`)
- **Schema (migration; you run it), new `UploadSession`:**
  - `id`, `releaseId` (FK cascade), `createdById`, `objectKey`, `storageUploadId` (the OCI multipart id), `fileName`, `contentType`, `sizeBytes`, `partSize`, `partsDone`, `etags Json`, `hashState Bytes`, `declaredSha256`, `kind`, `platform`, `replaceFileId`, `createdAt`, `updatedAt`;
  - `@@unique([releaseId, declaredSha256])`, so creating the same file again **returns the existing session** (that's how a client resumes even after losing its id).
- **Storage driver:** `createUpload`, `uploadPart`, `completeUpload`, `abortUpload` (OCI multipart already does this inside `putStream`; local: part files in a temp dir, joined on complete). `putStream` keeps working on top of them for the smoke scripts.
- **Endpoints** (creating DEV, editable states; the same 403/404/409 rules as today):
  - **`POST /releases/:id/uploads { name, size, sha256, kind?, platform?, replace? }`:**
    - validates the size and runs the same quick rules as `/files/check` with the hash (no ranges here; the stored object is inspected at complete);
    - creates the OCI multipart upload and the session, or returns the existing one;
    - responds `{ uploadId, partSize, partsDone }`.
  - **`PUT /releases/:id/uploads/:uploadId/parts/:n`** (raw `application/octet-stream`, exactly `partSize` bytes, or the remainder for the last part):
    - parts must arrive **in order**: `n = partsDone + 1`; `n ≤ partsDone` returns 200 (already stored, idempotent); a gap gives `409 PART_OUT_OF_ORDER` with `expected`;
    - the body (≤ 10 MiB) is read, hashed incrementally (**`hash-wasm` on the server: its hasher state `save()`/`load()` persists in `hashState`**, so the whole-file SHA-256 survives restarts), and sent with `uploadPart`;
    - the session row is updated under a row lock.
  - **`GET /releases/:id/uploads`:** the dev's open sessions for the release (`{ uploadId, name, size, partsDone, partSize, sha256 }`), so the panel can rebuild state.
  - **`POST /releases/:id/uploads/:uploadId/complete`:**
    - all parts present, and the final hash must equal the declared one (else `422 CHECKSUM_MISMATCH`, and the session is aborted);
    - then commit, re-inspect the stored object, apply the file rules, insert the row and delete the session; this is today's upload tail, moved here;
    - responds `{ file }`.
  - **`DELETE /releases/:id/uploads/:uploadId`:** aborts the multipart upload and deletes the session.
- **Clean-up without a scheduler:**
  - sessions untouched for over **24 h** are aborted lazily, whenever that release's sessions are listed or created;
  - deleting a release aborts its sessions;
  - the documented OCI bucket lifecycle rule stays as the backstop for orphaned parts.
- **Part size:** 10 MiB, the existing `UPLOAD_PART_BYTES`, already proven with OCI. A 600 MB file is 60 parts.
- **Removed:** the old multipart `POST /releases/:id/files` and `uploadReleaseFile` streaming code, with busboy kept only if something else uses it.

## 6.2 Client: one app-wide upload store (replaces the per-editor queue)
- **New `client/src/features/uploads/`** (framework-free, like today's `upload-queue.ts`, which it grows out of):
  - **`upload-store.ts`:** items carry `releaseId` plus a release label; statuses `queued`, `checking`, `hashing`, `uploading`, `paused`, `waiting` (offline or retrying), `needsFile` (after a refresh), `done`, `failed`, `blocked`, `cancelled`, `conflict`. Concurrency stays at 2.
  - **Pipeline:** check versions → hash (worker) → final check → **create session** → send parts one by one (XHR per part for progress) → complete.
  - **Pause:** aborts the current part request → `paused`. **Resume:** asks the server for `partsDone`, then continues.
  - **Auto-retry:** a part failing on a network error or 5xx retries with backoff (1, 2, 5, 10, 30 s). When offline, it waits for the browser's `online` event (`waiting`), then continues. 409 `PART_OUT_OF_ORDER` re-syncs to `expected`.
  - **The lost-response recovery from today stays:** on complete, a lost response → look the file up by SHA-256.
- **Persistence in IndexedDB** (`upload-persistence.ts`, behind a small interface so tests use an in-memory fake): stores `{ id, releaseId, releaseLabel, name, size, lastModified, sha256, uploadId, kind, os, replace, fileHandle? }`. Written on every status change; removed on done, cancel or remove.
- **File handles (Chrome and Edge):**
  - **drop:** `DataTransferItem.getAsFileSystemHandle()`;
  - **pick:** `showOpenFilePicker()` when available, otherwise the existing `<input type=file>`.
  - **`FileDropzone`** passes `{ file, handle? }`.
- **After a refresh:** the store reloads from IndexedDB, and every unfinished item becomes `needsFile`.
  - **With a handle, a Resume click:** `handle.requestPermission({ mode: "read" })` → `getFile()`. If size and `lastModified` match → continue from `partsDone` (the server verifies the final hash anyway); otherwise start over.
  - **Without a handle:** "Pick *setup.exe* to resume" opens a picker. Name and size must match, the file is re-hashed, and a different hash → it's treated as a new file.
- **Navigation:** the store lives at app level, so leaving the editor no longer cancels anything. The editor's `beforeunload` warning stays while bytes are moving.

## 6.3 UI
- **New `UploadPanel`** (bottom-right, in `StaffShell`):
  - a collapsible header: "Uploading 2 of 5 · 640 MB of 1.2 GB" with overall progress;
  - one row per file: name, "v1.135.0 · Product", a progress bar, status text and actions (Pause, Resume, Cancel, Remove, Pick file / Resume after refresh), plus blocked reasons and warnings as in today's `QueueRow`;
  - it hides when empty, and finished rows clear after a few seconds or on dismiss.
- **Editor:** its file section shows that release's items from the same store, reusing `QueueRow` with Pause and Resume added. Saved files appear as today.
- **The full-page loader flash on a new release's first drop is fixed** (seed `useRelease` from the create response).

## 6.3b Publishing in the same panel (admin)
**Why it differs from uploads:**
- Publishing is a **server-side background job** (the copy from staging to the release bucket, `publish.service.ts`, an in-memory `jobs` map, polled through `GET /releases/:id/publish-status`).
- So a **refresh or navigation never stops it**. The panel only has to *follow* it, from any page.
- There's **no pause or cancel**: publishing is all-or-nothing by design, and a half-copied release is never published.

**Server:**
- **New `GET /api/releases/publish-jobs`** (ADMIN): the jobs still running or recently settled, each `{ releaseId, version, productName, job }`, read from the existing in-memory registry.
- **Why it's needed:** after a refresh (or on another tab), the panel learns what's publishing without knowing the release ids.
- **Tests:** admin only (DEV and customer → 403); it lists a running job; a settled job stays listed for a short while (the registry's existing expiry), then drops off.

**Client:**
- **The same app-wide store** gets a second kind of item, `publish`: `{ releaseId, label, job }`.
  - **Added** when an admin clicks Publish (`ReleaseActions` → the store, instead of only the page-local `usePublishJob`).
  - **On load or refresh,** the store calls `publish-jobs` once to pick up running jobs.
- **One poller for all publish items** (every 1 s while any is running, reusing `isPublishRunning`, `isPublishSettled` and the "server lost the job" handling now in `usePublishJob`). The release page reads the same store, so its `PublishProgressBar` and the panel always agree.
- **Panel row:**
  - "Publishing EMASS IDE v1.135.0", showing the phase text (`publishLabel`), "2 of 3 files" and the weighted percent bar the server already computes;
  - actions: **View release**;
  - **when done:** "Published" with a success toast, and the row clears after a few seconds;
  - **if it fails:** the server's error and **Open release** (where Publish can be retried);
  - **if interrupted** (server restart): "Publishing stopped; the release is still in review. Publish again."
- **The header totals cover both kinds,** for example "Uploading 1 · Publishing 1".
- **`usePublishJob` becomes a thin reader** of the store, so there's no duplicate polling.
- **Tests:**
  - a publish item is added on Publish and followed to done or failed;
  - picked up from `publish-jobs` after a "refresh";
  - interrupted handling;
  - one poll per second for several running jobs.

## 6.4 Tests
- **Server unit:**
  - the hash-state round-trip (`save`, `load`, then continue = one-shot SHA-256);
  - the local driver's multipart operations; the OCI driver's multipart operations (mocked client).
- **Server integration:**
  - create, then re-create returns the same session;
  - parts in order, a repeated part is idempotent, a gap → 409;
  - a wrong last-part length;
  - complete: hash mismatch → 422 and aborted; a blocked file → 409 and aborted; success → row inserted, session gone;
  - abort; another DEV → 403; locked release → 409;
  - 24 h expiry; deleting a release aborts its sessions.
- **The old upload tests move to the new protocol** through a test helper that sends a file in parts.
- **Client unit (fake API, fake hash, in-memory persistence):**
  - pause and resume; auto-retry with backoff; the offline-to-online wait;
  - out-of-order resync;
  - rebuild after "refresh" → `needsFile`; resume with a handle (fake permission); resume by picking (name, size and hash check);
  - lost-response recovery;
  - concurrency of 2 across releases.
- **Manual:**
  - refresh mid-upload → Resume (Chrome) continues from the last piece;
  - pause and resume;
  - stop the server mid-upload → it resumes by itself once the server is back;
  - navigate away → the upload keeps going and the panel shows it;
  - Firefox: refresh → pick the file → it continues.
  - **As an admin, Publish:**
    - the panel shows "Publishing v… · 2 of 3 files";
    - navigate away or refresh → the panel picks the job up again;
    - it ends "Published" with a toast;
    - a failed or interrupted publish shows its reason, with Open release.

## 6.5 Docs and Phase 5 wrap-up
- `server/docs/releases/file-checks.md` (from Phase 5) gains an **Uploads** section covering the protocol, resume rules, limits and clean-up.
- **Also:** `release-management.md`, `architecture.md` (`hash-wasm` on the server, IndexedDB on the client), the AGENTS.md upload line, OpenAPI, and the operations doc (lifecycle rule).
- **The task file** is then finished and converted to docs.

## Order of work (I stop for review after each)
1. 6.1 server, and **⏸ you run the migration**.
2. 6.2 store, plus the persistence and resume logic, with tests; includes the 6.3b `publish-jobs` endpoint and publish items.
3. 6.3 panel and editor UI.
4. 6.4 manual pass.
5. 6.5 docs.
