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

Decided: the staff dashboard has no "Customer view". The catalog is
customer-only (staff are redirected to `/releases`). If a pre-publish preview
is ever needed, it belongs on the release detail page, not in the nav.

Out of scope (separate task, needs download tracking):
- The customer catalog API, download tokens and PARs, and the `Download` log.
- Rollback emails to everyone who downloaded the bad build.

## Decisions

| Topic | Decision |
|---|---|
| Upload path | The browser streams to our API. Express streams to OCI and computes SHA-256 on the fly; nothing is buffered in memory |
| Size cap | 1 GiB per file (`MAX_UPLOAD_BYTES`) |
| Categories | **SDK** has a platform: Windows, macOS or Ubuntu (no arch), with at most one SDK per platform per release. **Doc** is any other file (PDF, HTML, ZIP…), shown by its original file name; no doc type or title |
| Release notes | Two flows, both optional. **Markdown:** typed or pasted in the editor and stored in `Release.notes`; customers see a "Release notes" tab only when it's non-empty. **PDF:** uploaded as a regular Doc file next to the SDKs (Markdown left empty) and shown under Documentation. No PDF-to-text import |
| Versions | Semver `MAJOR.MINOR.PATCH`, unique per product. Must be newer than the highest version ever shipped (including archived and rolled back). The API suggests the next patch, minor and major |
| Review | Every release goes DRAFT → IN_REVIEW → PUBLISHED. Only ADMIN publishes, requests changes or rolls back |
| Editing | DRAFT and CHANGES_REQUESTED are fully editable. IN_REVIEW is locked (withdraw to edit). PUBLISHED allows notes only, and edits are logged. Files never change after publish |
| Rollback | Moves the release to ROLLED_BACK and restores the newest older ARCHIVED release to PUBLISHED, in one transaction. The email to downloaders is deferred |
| Storage | One bucket for now, with `staged/` and `releases/` prefixes. `STORAGE_DRIVER=oci\|local`, where `local` (`server/.tmp/storage`) serves dev and tests without cloud credentials |

## State machine

| From | Action | To | Who |
|---|---|---|---|
| (none) | create | DRAFT | DEV, ADMIN |
| DRAFT / CHANGES_REQUESTED | submit | IN_REVIEW | DEV, ADMIN |
| IN_REVIEW | withdraw | DRAFT | DEV, ADMIN |
| IN_REVIEW | request changes (feedback required) | CHANGES_REQUESTED | ADMIN |
| IN_REVIEW | publish | PUBLISHED (the previous PUBLISHED becomes ARCHIVED) | ADMIN |
| PUBLISHED | roll back (reason required) | ROLLED_BACK (the newest older ARCHIVED becomes PUBLISHED) | ADMIN |
| DRAFT / CHANGES_REQUESTED | delete | (removed, staged objects deleted) | DEV, ADMIN |

Submit requires all of these:
- at least one file;
- every SDK file has a platform (docs need nothing extra);
- a version newer than the highest shipped.

Publish re-checks the version rule.

## Data model (needs migration approval)

- **Enums:**
  - `ReleaseStatus`, `ReleaseFileKind { SDK DOC }`, `SdkPlatform { WINDOWS MACOS UBUNTU }`.
  - `ReleaseEventType`: the kind of each activity-log entry, used to render the
    timeline ("Ada published v2.5.0") and to filter audits: `CREATED, EDITED,
    FILE_ADDED, FILE_REMOVED, FILE_REMAPPED, SUBMITTED, WITHDRAWN,
    CHANGES_REQUESTED, PUBLISHED, ARCHIVED, ROLLED_BACK, RESTORED, NOTES_EDITED`.
- **`Release`:**
  - Fields: productId, version, versionMajor/Minor/Patch, status, notes
    (optional Markdown, empty by default), createdBy, publishedAt, publishedBy,
    timestamps.
  - Unique on (productId, version).
- **`ReleaseFile`:**
  - Fields: kind, platform? (SDK only), originalName, contentType, sizeBytes
    (BigInt), sha256, objectKey.
  - Unique on (releaseId, platform).
- **`ReleaseEvent`:** type, actor, note?, meta (JSON)?, createdAt. Append-only.

## Storage keys

- Staged: `staged/{productId}/{releaseId}/{fileId}/{safeName}`
- Published: `releases/{productId}/{version}/{fileId}/{safeName}`. It's copied on publish, then the staged copy is deleted. The `fileId` segment guarantees no overwrite.

## API (`/api/releases`, staff only, enforced on the server)

- **Read:**
  - `GET /` lists releases (filters: status, productId, q; cursor pagination).
  - `GET /next-version?productId=`.
  - `GET /:id` returns the release with its files and events.
- **Edit:**
  - `POST /` creates a release.
  - `PATCH /:id` updates the version and notes (notes only once published).
- **Files:**
  - `POST /:id/files` streams a single multipart upload.
  - `PATCH /:id/files/:fileId` remaps a file.
  - `DELETE /:id/files/:fileId` removes one.
- **Workflow:**
  - `POST /:id/submit` and `POST /:id/withdraw`.
  - `POST /:id/request-changes`, `POST /:id/publish` and `POST /:id/rollback` (ADMIN only).
  - `DELETE /:id`.

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
- Publishing:
  - copies the objects to `releases/`;
  - archives the previous published release;
  - is all-or-nothing: if the copy fails, the DB doesn't change.
- Rollback restores the previous archived release. With nothing to restore, it fails with `NO_RESTORE_TARGET`.
- The activity log lists every event with actor, time and note.

## Risks / follow-ups

- **Bandwidth:** streaming through the VM uses VM bandwidth. Fine at 1 GiB, but direct-to-OCI PARs are an option later.
- **Copy cost:** copies of large objects on publish are asynchronous work requests in OCI. Publishing waits for them, using the existing poll in `copyObject`.
- **Two-bucket split:** later, add `OCI_STAGING_BUCKET` and a bucket parameter in `storage.service.ts`.
- **Download tracking:** needed for rollback emails and the customer catalog.
- **HubSpot download activity** (part of the downloads task): users now carry
  `hubspotContactId`. Planned approach:
  - **Delivery:** write a `HubspotOutbox` row in the same transaction as the
    download log. A scheduler job sends pending rows with retries and backoff,
    so outages don't lose events.
  - **Any HubSpot tier:** contact properties (`emass_last_download_at`,
    `emass_last_downloaded_sdk`, `emass_download_count`), defined by
    `npm run hubspot:setup` and usable in HubSpot lists and workflows.
  - **Optional:** custom behavioral events (`POST /events/2026-03/send`, legacy
    `/events/v3/send`) with `objectId` = the stored contact ID. They need an
    event definition and the `analytics.behavioral_events.send` scope;
    creating events in the HubSpot UI is an Enterprise feature, so confirm the
    subscription first.
