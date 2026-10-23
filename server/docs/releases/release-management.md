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
    anything ever shipped.
- **Upload path:** each file is streamed through our API (busboy → OCI
  multipart) as soon as it's dropped, two at a time.
  - **Why not browser-to-OCI write PARs:** they lose the trusted
    server-computed SHA-256 and would create PARs for staged objects, which
    AGENTS.md forbids.
  - Multipart, not raw-body, was a product decision.
- **The draft is the release row,** created on the first drop. Files are
  saved as their upload finishes, so a refresh loses nothing.
- **Type and platform are draft edits:** uploads never wait for them, and an
  undetected file uploads *unmapped* (`kind` null).
  - Mappings are saved together with **Save draft**, in one `PATCH`. The
    server checks the final state of all files, so swaps work and a platform
    on two files fails with `DUPLICATE_PLATFORM`.
  - A new drop whose detected platform is already taken is held in the
    browser ("Replace it, or change this file's type") instead of uploaded.
  - One SDK per platform (Windows, macOS, Ubuntu); no architectures.
- **Storage keys:** `staged/{productId}/{releaseId}/{uuid}/{safeName}` →
  `releases/{productId}/{version}/{uuid}/{safeName}`.
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
- **Rollback:** synchronous and copies nothing. It restores the newest
  ARCHIVED release with a lower version (never a rolled-back one), or fails
  with `NO_RESTORE_TARGET`.
- **History lives on events,** not on the release: review feedback (each
  round) and rollback reasons are event notes. The release keeps only what
  lists and rules need.
- **Notes editor:** Markdown with a toolbar, shortcuts and formatted paste
  (turndown, lazy-loaded), instead of a WYSIWYG editor.

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
