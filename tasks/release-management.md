# Release management backend (uploads, review, activity, rollback, editing)

Status: spec agreed (2026-10-19). Implementation in progress.
This builds the real backend behind the staff dashboard, which is frontend-only
today (see `tasks/release-workflow.md`). The UI restructure (Releases vs Review
queue, Customer view) is deliberately out of scope until this lands.

## Scope

- Staff (DEV, ADMIN) create a release for one of the two products defined in
  code, pick a version, upload files, map them, optionally write Markdown
  release notes, and submit for review.
- ADMIN publishes, requests changes (with feedback) or rolls back.
- Every action is recorded in an append-only activity log.
- Files live in the private OCI bucket: under `staged/` until published, then
  under `releases/`.

Out of scope (separate task, needs download tracking):
- The customer catalog API, download tokens and PARs, and the `Download` log.
- Rollback emails to everyone who downloaded the bad build.

## Decisions

| Topic         | Decision                                                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload path   | Each file streams through our API as soon as it is dropped (one request per file, 2 in parallel). Express pipes it into an OCI multipart upload in `staged/` and computes SHA-256 on the fly; nothing is buffered in memory. No write PARs: the checksum stays server-computed and no PAR ever exists for staged objects. |
| Size cap      | 1 GiB per file (`MAX_UPLOAD_BYTES`)                                                                                                                                                                                                                                                                                       |
| Categories    | **SDK** has a platform: Windows, macOS or Ubuntu (no arch), with at most one SDK per platform per release. **Doc** is any other file (PDF, HTML, ZIP…), shown by its original file name; no doc type or title                                                                                                             |
| Release notes | Two flows, both optional. **Markdown:** typed or pasted in the editor and stored in `Release.releaseNotes`; customers see a "Release notes" tab only when it's non-empty. **PDF:** uploaded as a regular Doc file next to the SDKs (Markdown left empty) and shown under Documentation. No PDF-to-text import             |
| Versions      | Semver `MAJOR.MINOR.PATCH`, unique per product. Must be newer than the highest version ever shipped (including archived and rolled back). The API suggests the next patch, minor and major                                                                                                                                |
| Review        | Every release goes DRAFT → IN_REVIEW → PUBLISHED. Only ADMIN publishes, requests changes or rolls back                                                                                                                                                                                                                    |
| Editing       | DRAFT and CHANGES_REQUESTED are fully editable. IN_REVIEW is locked (withdraw to edit). PUBLISHED allows notes only, and edits are logged. Files never change after publish                                                                                                                                               |
| Rollback      | Moves the release to ROLLED_BACK and restores the newest older ARCHIVED release to PUBLISHED, in one transaction. The email to downloaders is deferred                                                                                                                                                                    |
| Storage       | Dev: one private bucket with `staged/` and `releases/` prefixes; prod: staging and release buckets (`OCI_STAGING_BUCKET` / `OCI_RELEASE_BUCKET`, default `OCI_BUCKET`). `STORAGE_DRIVER=oci\|local`, where `local` (`server/.tmp/storage`) serves dev and tests without cloud credentials                                 |

## Drafts, uploads and deletes

- **The draft is the `Release` row (DRAFT).** The editor asks for product and
  version first (`GET /next-version` suggests one); the first file drop
  creates the draft silently (`POST /`, `CREATED` event).
- **Files go straight to `staged/{productId}/{releaseId}/{uuid}/{safeName}`.**
  When the stream completes, the `ReleaseFile` row is inserted in the same
  request; from then on the file belongs to the draft whether or not the user
  clicks Save. A refresh, closed tab or dropped network loses nothing: the
  draft reopens from the Drafts tab with every completed file.
- **Uploads never wait for a type.** The client detects kind/platform from the
  file name and sends what it found as multipart fields ahead of the file
  part; an undetected file uploads *unmapped* (`kind` null) and gets its type
  in the editor.
- **Type and platform are draft edits.** Changing them in the editor is local
  (swaps and duplicates are fine while editing, shown as inline warnings);
  **Save draft** writes version, notes and every changed mapping in one
  `PATCH /:id`. The server checks the final state of all files and refuses a
  platform set on two files with `409 DUPLICATE_PLATFORM` (`details.duplicates`)
  without saving anything. Swaps apply in two steps so the unique index never
  sees half of one. **Send for review** saves first and is disabled while any
  upload runs, failed or is held, and while any file lacks a type (or an SDK a
  platform).
- **Detected platform already in use:** the new drop is held in the browser,
  not uploaded: "Windows is already uploaded: replace it, or change this
  file's type." Replace uploads with `replace` (new file first, then the old
  one is removed, so a failed replacement never loses the old file); changing
  the mapping starts the upload. A server `409 PLATFORM_TAKEN` (a race) lands
  in the same held state.
- **Deletes are immediate:** remove a file = delete the object (404 counts as
  success), then the row, so retries are safe. Deleting a draft deletes its
  objects, then the row (files cascade).
- **Failures:** an aborted or failed stream never becomes an object; the
  server aborts the OCI multipart upload. If the row insert fails after the
  stream completed, the request deletes the object. One bucket setting covers
  a server crash mid-upload (uncommitted multipart parts are kept and billed
  until aborted): for now fine. A crash in the instant between object
  commit and row insert leaves a rare orphan that is never served; accepted.

## Upload progress

- Per-file bars from `XMLHttpRequest.upload.onprogress` (`fetch` has no upload
  progress). The server streams with backpressure, so bytes sent track bytes
  stored; at 100% the bar shows "Finalizing…" until the response (last
  multipart commit + row insert), then ✓.
- Overall line: "3 of 5 uploaded · 1.2 GB of 2.0 GB" (size-weighted).
- States: queued, uploading %, finalizing, done, failed (Retry), cancelled
  (`xhr.abort()`). A `beforeunload` warning while uploads run.
- Before each upload the client makes one `authorizedRequest` (`/auth/me`) so
  the cookie is fresh; the server checks it once, at the start of the request.
- Timeouts: raise Node's `server.requestTimeout` (default 300 s) for the
  upload route (~2 h); Vite proxy and prod nginx need
  `client_max_body_size`, `proxy_request_buffering off` and long timeouts.

## Publishing (background job with progress)

- `POST /:id/publish` (ADMIN) checks IN_REVIEW and the version rule, registers
  an in-memory job keyed by release id (one VM) and answers **202**. A second
  click returns the same job.
- The job runs `copyObject` per file (staging bucket `staged/…` → release
  bucket `releases/{productId}/{version}/{uuid}/{safeName}`, same uuid), a server-side copy
  inside OCI with no bytes through the VM, and polls each work request
  (~1 s). Progress is size-weighted from each work request's
  `percentComplete`: `{ phase: copying|finalizing|done|failed, percent,
  filesDone, filesTotal, error? }`.
- When all copies complete, one transaction locks the product's release rows
  (`SELECT … FOR UPDATE`; one PUBLISHED release per product is a service
  rule), re-checks the version, archives the current PUBLISHED release
  (`ARCHIVED` event) and publishes this one (`publishedAt/By`, new object
  keys, `PUBLISHED` event). Then the staged objects are deleted directly.
- Failure: a failed copy marks the job failed, deletes the copies made so far
  and leaves the DB untouched ("Publish failed: retry"). A server restart
  mid-job also leaves the DB untouched; retrying is safe (same source, and the
  published key reuses the staged uuid, so a retry lands on its own orphan).
- Admin UI polls `GET /:id/publish-status` every second: "Copying files · 2 of
  3 · 64%" → "Finalizing" → "Published ✓". Closing the dialog doesn't cancel
  the job; reopening the release shows the progress.
- Rollback copies nothing (status change only), so it stays a normal
  synchronous request.
- **Spike before building:** time a ~1 GB `copyObject` (same region, across
  two buckets), check whether `percentComplete` moves gradually (if it jumps
  0→100 the bar falls back to files done/total), and confirm an aborted
  multipart upload leaves no object. `npm run storage:copy-smoke`.
  **Results, 2026-10-23, dev bucket, same-bucket mode:**
  - a 1 GiB server-side copy `staged/` → `releases/` took **11.8 s**;
  - `percentComplete` stayed at 0 and jumped to 100 at completion, with no
    values in between at 1 s polling;
  - no extra policy was needed for the same-bucket copy;
  - the upload of 1 GiB from a developer machine took 8.2 min (~17 Mbit/s,
    bound by their upload speed).

  **So:**
  - publishing is fast (~12 s/GiB), and `COPY_TIMEOUT_MS` (30 min) keeps
    wide headroom;
  - the dialog names the file in progress ("Copying file 2 of 3 · 64%
    overall", the percent moving per file) and sweeps a shimmer over the bar
    while a file copies, so it never looks frozen.

  **Pending:** the cross-bucket run (prod) once `OCI_STAGING_BUCKET` and
  `OCI_RELEASE_BUCKET` point at two real buckets. It confirms the Object
  Storage service policy.
- **As built** (`server/src/services/releases/publish.service.ts`):
  - `driver.copyObject` is one call for every setup: local folder copy; dev
    within one bucket (`staged/` → `releases/`); prod staging → release
    bucket. OCI polls the copy work request every `COPY_POLL_MS`, gives up
    after `COPY_TIMEOUT_MS` (`COPY_TIMEOUT`), and maps failed or cancelled
    copies to `COPY_FAILED` and a missing source to `SOURCE_NOT_FOUND`.
  - Up-front checks (synchronous 4xx, no job): IN_REVIEW, and submit's rules
    (`NO_FILES`, `FILE_TYPE_MISSING`, `SDK_PLATFORM_MISSING`,
    `VERSION_NOT_NEWER`).
  - The job: `{ phase: copying|finalizing|done|failed, filesTotal,
    filesDone, percent, error, startedAt, finishedAt }`. It's kept
    `PUBLISH_JOB_TTL_MS` (10 min) after it ends.
  - `GET /:id/publish-status` returns `{ job, status }`; `job` is null when
    none is known (never started, or lost in a restart).
  - Finalize locks the product's releases, then the release. It fails with
    `RELEASE_LOCKED` if the release left IN_REVIEW, and with
    `RELEASE_CHANGED` if its files changed during the copy (sent back and
    resubmitted). It re-checks the version, archives the previous release
    ("Replaced by vX"), publishes, and repoints every `objectKey` to its
    `releases/…` key.
  - Unexpected errors in the job become `PUBLISH_FAILED`.
- **Prod setup:** OCI performs the copy as the Object Storage service, which
  needs its own policy (`Allow service objectstorage-<region> to manage
  object-family in compartment …`). The VM's instance principal needs read
  and delete on the staging bucket and write on the release bucket.

## State machine

| From | Action | To | Who |
|---|---|---|---|
| (none) | create | DRAFT | DEV |
| DRAFT / CHANGES_REQUESTED | submit | IN_REVIEW | DEV (creator) |
| IN_REVIEW | withdraw | DRAFT | DEV (creator) |
| IN_REVIEW | request changes (feedback required) | CHANGES_REQUESTED | ADMIN |
| IN_REVIEW | publish | PUBLISHED (the previous PUBLISHED becomes ARCHIVED) | ADMIN |
| PUBLISHED | roll back (reason required) | ROLLED_BACK (the newest older ARCHIVED becomes PUBLISHED) | ADMIN |
| DRAFT / CHANGES_REQUESTED | delete | (removed, staged objects deleted) | DEV (creator) |

Only the DEV who created a release can change it (edit, files, submit,
withdraw, delete); other DEVs and ADMINs can read it. ADMIN never creates or
edits releases: their job is review and publish.

Submit requires all of these:
- at least one file;
- every SDK file has a platform (docs need nothing extra);
- a version newer than the highest shipped.

Publish re-checks the version rule.

## Data model (finalized 2026-10-21; migration needs approval)

Defined in `server/prisma/schema.prisma`.

- **`Product`:** name, description?, detail?, imageUrl?, sortOrder (required,
  default 0), isActive. No slug: URLs use the UUID (`/catalog/:productId`),
  so similar names never collide and renames change nothing. Seeded by
  `npm run seed:products` with fixed ids; admin CRUD later. The catalog query
  is `where isActive order by sortOrder, name`, indexed on
  `(isActive, sortOrder)`.
- **Enums:** `ReleaseStatus`, `ReleaseFileKind { SDK DOC }`,
  `SdkPlatform { WINDOWS MACOS UBUNTU }`, and `ReleaseEventType` with only the
  real workflow transitions: `CREATED, SUBMITTED, WITHDRAWN, CHANGES_REQUESTED,
  PUBLISHED, ARCHIVED, ROLLED_BACK, RESTORED, NOTES_EDITED`. Draft edits and
  file add/remove/remap are deliberately not events.
- **`Release`:** productId → Product, version + parsed semver parts, status,
  releaseNotes, createdBy, `publishedAt`, `publishedBy`. Unique on
  (productId, version); `(productId, publishedAt)` indexed for the customer
  version list.
- **Field placement rule:** a field lives on `Release` only if it is read for
  many releases at once (lists, sorting, catalog, business rules), so it is
  O(1) per row. Anything read only on one release's detail is history and
  lives on `ReleaseEvent`: review feedback (each `CHANGES_REQUESTED` note, one
  per review round) and the rollback reason/time (`ROLLED_BACK` note and
  `createdAt`).
- **`ReleaseFile`:** kind? (null while unmapped in a draft), platform? (SDK only), originalName, contentType,
  sizeBytes (BigInt), sha256, objectKey. Unique on (releaseId, platform).
- **`ReleaseEvent`:** type, actor, note?, createdAt. Append-only history,
  written in the same transaction as each transition and read one release at
  a time (timeline, review thread, rollback callout). The service requires a
  note for `CHANGES_REQUESTED` and `ROLLED_BACK`. Low volume (~10 rows per
  release), indexed on (releaseId, createdAt). `CREATED` fires once, on the first draft save
  (`POST /releases`); later draft edits add no events. Create-and-submit in
  one action writes `CREATED` then `SUBMITTED` in one transaction.
- **Changes-requested loop:** request-changes (feedback required) sets
  `CHANGES_REQUESTED` and writes a `CHANGES_REQUESTED` event whose note is the
  feedback; every review round keeps its own. The dev's banner and the
  re-review "Previously requested" callout read the latest such event. The dev edits while the status stays `CHANGES_REQUESTED`:
  replacing a build uploads a new file (fresh SHA-256) as a new `ReleaseFile`
  row and key, and deletes the old *staged* object (never-overwrite applies
  to published files only). Version and notes can change too; edits add no
  events. Resubmitting writes `SUBMITTED` and moves to `IN_REVIEW`. On
  re-review the UI shows a "Previously requested" callout and marks files
  whose `createdAt` is after the latest `CHANGES_REQUESTED` event as
  "Updated after feedback".
- **`ProductResource`:** product-level static files (datasheets, schematics),
  replaceable any time, shown on every version.

## Storage keys

- Staged: `staged/{productId}/{releaseId}/{uuid}/{safeName}`
- Published: `releases/{productId}/{version}/{uuid}/{safeName}`. It's copied on publish, then the staged copy is deleted. The `uuid` segment (same value as staged) guarantees no overwrite.
- `uuid` is `crypto.randomUUID()` (v4), generated before streaming starts and
  separate from `ReleaseFile.id`. It is not a security control: the bucket is
  private and a PAR URL reveals its key anyway; access rests on the PAR token.
- `safeName` is derived from the user's file name: strip path separators, `..`
  and control characters, keep `[A-Za-z0-9._-]`, cap at ~100 chars, fall back
  to `file`. The original name stays in `originalName` and is served via
  Content-Disposition.
- Reads always use the stored `objectKey`; keys are never rebuilt from parts.

## API (`/api/releases`, staff only, enforced on the server)

`GET /api/products` (any signed-in user) lists active products with their
UUIDs for the editor and filters.

- **Read:**
  - `GET /` lists releases (filters: status, productId, q; cursor pagination). Returns `{ releases, nextCursor, counts }`; `counts` is per status and ignores the status filter.
  - `GET /next-version?productId=`.
  - `GET /:id` returns the release with its files, events and `review: { currentPublished, restoreTarget }` (what a publish would archive while IN_REVIEW; what a rollback would restore while PUBLISHED).
- **Edit:**
  - `POST /` creates a release.
  - `PATCH /:id` saves the draft: `version`, `releaseNotes` and `files: [{ id, kind | null, platform | null }]`, any of them (notes only once published).
  - `PATCH /:id/notes { releaseNotes }` edits a PUBLISHED release's notes (creating DEV or ADMIN), logged as `NOTES_EDITED`.
- **Files:**
  - `POST /:id/files` streams a single multipart upload (busboy). The fields `kind`, `platform` and optional `replace` (a fileId) come before the one `file` part; the name and type come from the file part. `409 PLATFORM_TAKEN` (with `details.fileId`) when the platform already has an SDK; `replace` swaps that file atomically and keeps the old one if the upload fails.
  - `DELETE /:id/files/:fileId` removes one.
- **Workflow:**
  - `POST /:id/submit` and `POST /:id/withdraw`.
  - ADMIN only: `POST /:id/request-changes { note }` (IN_REVIEW → CHANGES_REQUESTED), `POST /:id/publish` (**202**, background job) and `POST /:id/rollback { reason }` (PUBLISHED → ROLLED_BACK; the newest *lower-version* ARCHIVED release of the product becomes PUBLISHED with a `RESTORED` event, all in one transaction under a product-wide lock; `409 NO_RESTORE_TARGET` when there is none). Note and reason: 1–2000 chars.
  - `GET /:id/publish-status` returns the publish job's progress.
  - `DELETE /:id`.
- **Error codes:** `RELEASE_NOT_FOUND`, `PRODUCT_NOT_FOUND` (404);
  `FORBIDDEN`, `NOT_RELEASE_OWNER` (403); `RELEASE_LOCKED`, `VERSION_TAKEN`,
  `VERSION_NOT_NEWER` (409); `NO_FILES`, `SDK_PLATFORM_MISSING` (400);
  `DELETE_FAILED` (502). Mappings add `DUPLICATE_PLATFORM` (409) and `FILE_TYPE_MISSING` (400, on submit). File routes add `FILE_NOT_FOUND` (404),
  `PLATFORM_TAKEN` (409), `FILE_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE`
  (415), `FILE_MISSING`, `TOO_MANY_FILES`, `FIELDS_AFTER_FILE`, `EMPTY_FILE`,
  `UPLOAD_INVALID`, `UPLOAD_ABORTED` (400) and `UPLOAD_FAILED` (502).

## Progress

- [x] Phase 1: storage drivers (local + OCI multipart), buckets, `safeName`
- [x] Phase 2: release core API (list, get, next-version, create, edit, submit, withdraw, delete; roles and ownership)
- [x] Phase 3: streaming file uploads, remap, file delete
- [x] Phase 4: client data layer and upload queue
- [x] Phase 5: client UI on the real API (manual end-to-end pass still to do)
- [x] Phase 6: release-notes editor (toolbar, shortcuts, formatted paste)
- [x] Phase 7: docs and ops

Admin review (second batch):

- [x] Storage copy with progress (`copyObject` on both drivers; `storage:copy-smoke`: same bucket done, cross-bucket pending)
- [x] Request changes and roll back (server; `review` block on the release detail)
- [x] Publish background job and publish-status (server)
- [x] Admin UI: publish dialog with live progress, request changes, roll back (manual end-to-end pass still to do)
- [x] Docs and ops (OpenAPI, architecture §12, docs/operations/release-storage.md)
- [x] Notes edits on published releases (creating DEV or ADMIN, logged as NOTES_EDITED)
- [x] Final record written: server/docs/releases/release-management.md (this task file is removed once the manual pass is done)

## Release notes editor

The customer view renders GitHub-flavoured Markdown (`react-markdown` +
`remark-gfm`): headings, bold, italic and strikethrough, bulleted, numbered and
task lists, links, inline code and code blocks, quotes, tables and rules. Raw
HTML stays off. Writers don't need to know Markdown:

- **Toolbar:** Heading, Bold, Italic, Bulleted list, Numbered list, Link, Code,
  Code block, Table. Buttons wrap the selection or insert a template.
  Shortcuts: Ctrl/⌘+B, I and K. The logic is a pure helper
  (`markdown-format.ts`) with unit tests.
- **Smart paste:** rich text pasted from Word, Google Docs, Confluence or the web
  is converted to Markdown (`turndown` + `turndown-plugin-gfm`, lazy-loaded).
  Plain-text pastes, and Ctrl+Shift+V, are left alone.
- **Preview:** Write/Preview tabs, plus side-by-side on wide screens.
- No WYSIWYG editor: toolbar plus smart paste covers release notes without a
  second document model or a heavy dependency.

## Acceptance criteria

- A DEV can create a draft, upload SDKs and docs (drag and drop, with progress), remap them, write Markdown notes (or attach PDF notes as a doc) and submit.
- A DEV gets 403 on publish, request changes and rollback. A CUSTOMER gets 403 on every `/api/releases` route.
- Uploading over 1 GiB fails with `FILE_TOO_LARGE`, and no partial object is left behind.
- Each stored file has a server-computed SHA-256 that matches `sha256sum` of the original.
- Uploads show per-file progress, survive a refresh (completed files stay on the draft) and can be cancelled or retried per file.
- Publishing:
  - answers 202 and reports progress via `GET /:id/publish-status`;
  - copies the objects to `releases/` in the release bucket;
  - archives the previous published release;
  - is all-or-nothing: if any copy fails, its partial copies are deleted and the DB doesn't change.
- Rollback restores the previous archived release. With nothing to restore, it fails with `NO_RESTORE_TARGET`.
- The activity log lists every event with actor, time and note.

