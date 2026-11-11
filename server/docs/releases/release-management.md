# Release management (staff dashboard)

## What was built

Developers own releases end to end. They create a release for a product,
stream SDKs and docs to private storage, set each file's type and platform,
write Markdown notes, and publish it themselves (a background job copies the
files under `publish/` and archives the previous release) or roll back (the
newest older archived release becomes published again). Every
transition is recorded in an append-only history. API: `/api/releases`,
`/api/products` (see `docs/api/openapi.json`). Deploy steps:
`docs/operations/release-storage.md`.

## Key decisions

- **Who does what (2026-11-10: the admin review step was removed):**
  - **Any DEV** can edit, upload to, publish, delete and roll back **any**
    release, so nothing is stuck when its creator is away. Events record who
    did what.
  - **ADMIN can only read** releases and download their files. Admins keep the
    dashboard, sign-up approvals, domain rules and settings.
  - Published releases allow **notes edits only**, each logged as
    `NOTES_EDITED`.
  - Enforced on the server: `requireRole` and `lockRelease` / `lockDraft`.
- **States:** DRAFT → PUBLISHED → ARCHIVED, plus ROLLED_BACK.
  - `IN_REVIEW` and `CHANGES_REQUESTED` were dropped; anything in them became
    a draft. The old `SUBMITTED`, `WITHDRAWN` and `CHANGES_REQUESTED` event
    types stay, so existing timelines keep their history.
  - Delete is allowed for DRAFT; it removes the draft objects and the history.
  - Versions are strict semver, unique per product, and must be newer than
    the highest **shipped** version of that product (PUBLISHED, ARCHIVED or
    ROLLED_BACK). Drafts don't count, so a draft may be lower
    than another draft. It's checked on create, on a version or product
    change, when publish starts and again as it finishes.
  - **A draft may have no version yet** (`Release.version` and its parts are
    nullable). Publish refuses it with `VERSION_REQUIRED`, so everything
    shipped has one. Several versionless drafts of one product can
    exist (Postgres allows many NULLs in the unique index).
  - **The product can change while it's a draft** (`PATCH { productId }`): the
    new product must be active, and the version (if any) is re-checked
    against it. Uploads in flight are unaffected.
- **Upload path:** each file is streamed through our API (busboy → OCI
  multipart) as soon as it's dropped, two at a time.
  - **Why not browser-to-OCI write PARs:** they lose the trusted
    server-computed SHA-256 and would create write PARs for draft objects, which
    AGENTS.md forbids.
  - Multipart, not raw-body, was a product decision.
- **The draft is the release row,** created on the first drop. Files are
  saved as their upload finishes, so a refresh loses nothing.
- **Editor (new and edit pages), files first (2026-10-30):** the dropzone is
  at the top and always enabled; product and version come after.
  - **Version from the SDK files:** the client reads versions from SDK file
    names (`versionsInName`, the same rule as the server's `versionsInText`)
    and, once uploaded, from each SDK file's `detectedVersions`.
    Documentation files never count.
  - **When the SDK files agree on one version,** it's used when the draft is
    created (or saved at once on an existing draft) and the field is
    **locked**: only the files can change it. Removing the disagreeing SDKs,
    or changing a file's type away from SDK, unlocks it.
  - **No version, or SDKs that disagree:** the field stays editable, with the
    files' versions offered as suggestions.
  - **A detected version the server refuses** (taken, not newer than
    shipped) isn't applied: the field stays editable with the server's
    message, and the files upload anyway (the draft starts without a version).
- **Type and platform are draft edits:** uploads never wait for them, and an
  undetected file uploads *unmapped* (`kind` null).
  - Mappings are saved together with **Save draft**, in one `PATCH`. The
    server checks the final state of all files, so swaps work and a platform
    on two files fails with `DUPLICATE_PLATFORM`.
  - A new drop whose detected platform is already taken is held in the
    browser ("Replace it, or change this file's type") instead of uploaded.
  - One SDK per platform (Windows, macOS, Ubuntu); no architectures.
- **File checks (blocking, before upload):** each dropped file is checked by
  the server first (version ranges, then the SHA-256), then checked again after
  upload.
  - Installers with duplicate bytes or a wrong or existing version are
    **blocked**.
  - Docs only warn.
  - Publish judges every file again and needs `confirmWarnings` for warnings.
  - Details, rules and measurements: `docs/releases/file-checks.md`.
- **Storage keys:** `draft/{uuid}/{safeName}` →
  `publish/{productId}/{version}/{uuid}/{safeName}`.
  - Draft keys carry no product or release, so a draft can change product,
    or get its version, after its files are uploaded. Publish files them under
    the release's product and version at that moment (`publishedKey`).
  - Older objects keep their `staged/…` and `releases/…` keys. `publishedKey`
    accepts every older draft form, and `isDraftKey` / `isPublishedKey` treat
    the old prefixes like the new ones.
  - The random uuid is reused on publish, so retries are idempotent.
  - `safeName` strips path tricks; the original name is kept separately.
  - Reads always use the stored `objectKey`.
- **Bucket:** one private bucket (`OCI_BUCKET`) in every environment. The
  local driver serves dev and tests.
- **Publish:** a 202 background job with polled progress, all-or-nothing.
  - Up-front checks: no upload still open, files mapped, version newer than
    shipped, no blocked file, warnings confirmed (recorded on the `PUBLISHED`
    event).
  - **Open uploads refuse it** (`409 UPLOADS_IN_PROGRESS`). An `UploadSession`
    row exists until its file is saved, cancelled or expired, so any row is a
    file the release would ship without. Uploads idle for 24 hours are expired
    first. The publish dialog lists the rest, and any developer can cancel
    them there.
  - A draft is still editable, so while a job runs its edits, uploads and
    deletes answer `409 RELEASE_PUBLISHING`.
  - The final transaction locks the product's releases, re-checks the status,
    that the files, version and product are what was copied
    (`RELEASE_CHANGED`) and the version rule, archives the previous release
    and publishes.
  - In-memory, one VM: a restart loses the job but never half-publishes.
- **Rollback (any DEV):** synchronous and copies nothing. It works on either
  customer-facing state:
  - **PUBLISHED:** becomes ROLLED_BACK. The newest ARCHIVED release with a
    lower version (never a rolled-back one) is promoted to PUBLISHED if there
    is one. Otherwise the product is left with no published release.
  - **ARCHIVED:** becomes ROLLED_BACK, withdrawn from the version picker; the
    published release is untouched.
  - **Two texts:**
    - an **internal reason** (required), stored on the `ROLLED_BACK` event;
    - an optional **message to customers** (at most 1,000 characters), used
      only in the email and not stored.
  - **Emails through the outbox** (`docs/operations/email-outbox.md`): the
    rollback transaction queues one "withdrawn" email for every distinct
    ACTIVE user with a `Download` of that release (role CUSTOMER only, checked in the
    query), and the
    worker sends them after the commit, paced and retried. Each points to
    the restored version or, for an archived rollback, the current published
    one; with neither, it says a new version will follow. When the batch is
    done, a `CUSTOMERS_NOTIFIED` event ("Emailed N customers… (M failed)",
    or "No customers had downloaded vX.") appears in the release's Activity.
- **Announcements on publish:** the publish's final transaction queues a
  "vX is available" email for every ACTIVE customer (role CUSTOMER) who downloaded **any
  other release of the product**, once each, sent by the same worker after
  rollback notices. A finished batch records `CUSTOMERS_NOTIFIED`
  ("Announced vX to N customers… (M failed)"); with nobody to tell, nothing
  is recorded. There's no opt-out yet.
- **History lives on events,** not on the release: confirmed warnings and
  rollback reasons are event notes. The release keeps only what
  lists and rules need.
- **Notes editor:** Markdown with a toolbar, shortcuts and formatted paste
  (turndown, lazy-loaded), instead of a WYSIWYG editor.

## Purging test releases

`npm run releases:purge` (`scripts/purge-releases.ts`) deletes shipped
releases for good, for cleaning up after testing:
- their objects in storage;
- the release itself, with its files, events and upload sessions;
- its `Download` and `ActivityLog` rows.

```
npm run releases:purge -- --product "EMASS Core SDK" [--version 1.2.3] [--include-archived]
npm run releases:purge -- --all --execute
```

- **A dry run unless `--execute`.** It lists each version, its object keys and
  bucket, its download count, and any version it would restore.
- **Which releases:** `PUBLISHED` by default; `--include-archived` adds
  `ARCHIVED` and `ROLLED_BACK`. `--product` takes a name or an id. Either it or
  `--all` is required.
- **Restoring:** when a `PUBLISHED` release is removed, the newest `ARCHIVED`
  version that stays is published again, with no release event.
- **Objects go first.** If any object fails to delete, that release stays
  and the run exits 1, so a re-run retries it.
- **It can't be undone.** It emails no one, and download totals already in
  HubSpot are not reduced.

## Assumptions

- **A single API VM.** The publish job registry and the upload timeout
  (`server.requestTimeout`, 2 h) are per process. More VMs would need a
  shared job store.
- **In-region OCI copies are fast:** measured at 1 GiB in ~12 s, with
  `percentComplete` jumping 0 → 100, so the UI shows the file in progress
  plus an overall percent.
- **Developers' upload speed** bounds large uploads; nothing on our side can
  speed it up.
- **Production nginx and IAM** follow `docs/operations/release-storage.md`.

## Risks / follow-ups

- **Unverified:**
  - the **manual end-to-end pass** of the developer and admin flows in the
    browser.
- **Rare orphans, accepted:**
  - a crash between an object's commit and its row insert;
  - a failed draft-object delete after publish.

  Both are logged at `error`, and orphans are never served.
- **In-app navigation** away from the editor cancels running uploads, because
  `BrowserRouter` has no `useBlocker`. Tab close is warned.
- **Deferred:**
  - customer downloads (catalog API, ~60 s PARs, the `Download` log);
  - opting out of release announcements;
  - product and resource CRUD;
  - HubSpot download properties.
