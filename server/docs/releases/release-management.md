# Release management (staff dashboard)

## What was built

Developers create a release for a product, stream SDKs and docs to private
staging storage, set each file's type and platform, write Markdown notes and
send it for review. Admins request changes, publish (a background job copies
the files to the release bucket and archives the previous release) or roll
back (the newest older archived release becomes published again). Every
transition is recorded in an append-only history. API: `/api/releases`,
`/api/products` (see `docs/api/openapi.json`). Deploy steps:
`docs/operations/release-storage.md`.

## Key decisions

- **Who does what:**
  - Only the **DEV who created** a release changes it: edit, upload, map,
    submit, withdraw, delete.
  - Other DEVs and ADMINs can read it.
  - **ADMIN never edits:** they review, publish and roll back.
  - Published releases allow **notes edits only**, by the creating DEV or any
    ADMIN, each logged as `NOTES_EDITED`.
  - Enforced on the server: `requireRole` plus `lockOwnedRelease` /
    `lockRelease`.
- **States:** DRAFT → IN_REVIEW → PUBLISHED → ARCHIVED, plus
  CHANGES_REQUESTED (review loop) and ROLLED_BACK.
  - Delete is allowed for DRAFT and CHANGES_REQUESTED; it removes the staged
    objects and the review history. We chose to keep it that wide.
  - Versions are strict semver, unique per product, and must be newer than
    the highest **shipped** version of that product (PUBLISHED, ARCHIVED or
    ROLLED_BACK). Drafts and reviews don't count, so a draft may be lower
    than another draft. It's checked on create, on a version or product
    change, at submit and again at publish.
  - **A draft may have no version yet** (`Release.version` and its parts are
    nullable). Submit refuses it with `VERSION_REQUIRED`, so everything in
    review or shipped has one. Several versionless drafts of one product can
    exist (Postgres allows many NULLs in the unique index).
  - **The product can change while it's a draft** (`PATCH { productId }`): the
    new product must be active, and the version (if any) is re-checked
    against it. Uploads in flight are unaffected.
- **Upload path:** each file is streamed through our API (busboy → OCI
  multipart) as soon as it's dropped, two at a time.
  - **Why not browser-to-OCI write PARs:** they lose the trusted
    server-computed SHA-256 and would create PARs for staged objects, which
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
  - Submit judges every file again and needs `confirmWarnings` for warnings.
  - Details, rules and measurements: `docs/releases/file-checks.md`.
- **Storage keys:** `staged/{uuid}/{safeName}` →
  `releases/{productId}/{version}/{uuid}/{safeName}`.
  - Staged keys carry no product or release, so a draft can change product,
    or get its version, after its files are uploaded. Publish files them under
    the release's product and version at that moment (`releasedKey`).
  - Drafts uploaded before 2026-10-30 keep their older
    `staged/{productId}/{releaseId}/{uuid}/{safeName}` keys; `releasedKey`
    accepts both and uses the release's current product either way.
  - The random uuid is reused on publish, so retries are idempotent.
  - `safeName` strips path tricks; the original name is kept separately.
  - Reads always use the stored `objectKey`.
- **Buckets:** one code path. Dev uses one private bucket with prefixes; prod
  uses private staging and release buckets. The local driver serves dev and
  tests.
- **Publish:** a 202 background job with polled progress, all-or-nothing.
  - Up-front checks match submit's rules.
  - The final transaction locks the product's releases, re-checks the
    status, the files (`RELEASE_CHANGED`) and the version, archives the
    previous release and publishes.
  - In-memory, one VM: a restart loses the job but never half-publishes.
- **Rollback (ADMIN):** synchronous and copies nothing. It works on either
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
  - **Emails after the commit** (`rollback-notify.service.ts`): every distinct
    ACTIVE user with a `Download` of that release (customers only) gets one
    "withdrawn" email. It points to the restored version or, for an archived
    rollback, the current published one; with neither, it says a new version
    will follow. Failures are logged per recipient. The outcome is recorded as
    a `CUSTOMERS_NOTIFIED` event ("Emailed N customers… (M failed)") in the
    release's Activity.
- **History lives on events,** not on the release: review feedback (each
  round) and rollback reasons are event notes. The release keeps only what
  lists and rules need.
- **Notes editor:** Markdown with a toolbar, shortcuts and formatted paste
  (turndown, lazy-loaded), instead of a WYSIWYG editor.

## Purging test releases

`npm run releases:purge` (`scripts/purge-releases.ts`) deletes shipped
releases for good, for cleaning up after testing:
- their objects in storage (a key under `releases/` goes to the release bucket,
  any other key to the staging bucket);
- the release itself, with its files, events and upload sessions;
- its `Download` and `ActivityLog` rows.

```
npm run releases:purge -- --product "EMASS Core SDK" [--version 1.2.3] [--include-archived]
npm run releases:purge -- --all --execute
```

- **A dry run unless `--execute`.** It lists each version, its object keys and
  buckets, its download count, and any version it would restore.
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
  - the **cross-bucket copy in production**: run `npm run storage:copy-smoke`
    with both bucket variables set;
  - the **manual end-to-end pass** of the dev and admin flows in the browser.
- **Rare orphans, accepted:**
  - a crash between an object's commit and its row insert;
  - a failed staged-object delete after publish.

  Both are logged at `error`, and orphans are never served.
- **In-app navigation** away from the editor cancels running uploads, because
  `BrowserRouter` has no `useBlocker`. Tab close is warned.
- **Deferred:**
  - customer downloads (catalog API, ~60 s PARs, the `Download` log);
  - emails to downloaders on rollback;
  - notifications (submit, changes requested, published);
  - product and resource CRUD;
  - HubSpot download properties.
