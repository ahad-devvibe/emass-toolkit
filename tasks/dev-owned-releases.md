# Developer-owned releases (no admin review)

Status: built (2026-11-10); waiting on the dev and production migration and the
by-hand check below

## Goal

Release management becomes a developer workflow from start to finish. A
developer drafts a release, publishes it and rolls it back. There is no review
step. Admins keep the dashboard, sign-up approvals, domain rules and settings.

New flow: `DRAFT → PUBLISHED → ARCHIVED`, with `ROLLED_BACK` as before.

## Decisions

- **Any developer manages any release.** Edit, publish, delete and roll back are
  open to every DEV, not only the creator. The activity log still records who
  did what.
- **Admins are read-only on releases.** They can list, open and download; they
  have no actions.
- **One bucket, two prefixes.** New uploads go to `draft/{randomId}/{file}`.
  Publishing moves them to
  `publish/{productId}/{version}/{randomId}/{file}`. Objects already stored
  under `staged/` and `releases/` keep working; nothing is moved.
- **Migration.** Releases in `IN_REVIEW` or `CHANGES_REQUESTED` become `DRAFT`
  and both statuses are dropped. The old review events (`SUBMITTED`,
  `WITHDRAWN`, `CHANGES_REQUESTED`) stay in the enum so existing timelines keep
  their history.

## Server

### Routes and roles (`server/src/routes/releases.routes.ts`)

- `staff` (DEV, ADMIN): `GET /`, `GET /:id`,
  `POST /:id/files/:fileId/download`.
- `dev` only: everything else, including `publish`, `publish-status`,
  `publish-jobs`, `rollback`, `PATCH /:id/notes` and `next-version`.
- Remove `POST /:id/submit`, `/withdraw` and `/request-changes`, with their
  controllers, services and schemas. `submitReleaseSchema` becomes
  `publishReleaseSchema`.

### Ownership

Files: `releases.service.ts`, `release-files.service.ts`,
`upload-sessions.service.ts`, `file-checks.service.ts`.

- Merge `lockOwnedRelease` into `lockRelease`: row lock plus status check, no
  owner check.
- Delete `notReleaseOwner` and every `createdById !== devId` check.
- `updatePublishedNotes`: any DEV.

### States

- `EDITABLE_STATUSES` and `JUDGED_STATUSES` become `[DRAFT]`.
- `releases.errors.ts`: drop the two status labels; reword "sending this for
  review" and "can't be submitted" to publish wording.
- `listReleases`: remove `needsYou`.
- `reviewContext`: `currentPublished` is returned for a `DRAFT` (what
  publishing would archive).

### Publish straight from a draft (`publish.service.ts`)

- `startPublish(devId, releaseId, { confirmWarnings })` locks the release in
  `DRAFT` and runs the checks `submitRelease` ran. They move into one helper,
  `assertPublishable(tx, release, confirmWarnings)`, in `releases.service.ts`:
  - `assertReadyForReview`, renamed `assertReadyToPublish`: at least one file,
    a type on every file, a platform on every SDK, a version newer than
    anything shipped;
  - blocked files answer `FILE_BLOCKED`;
  - warnings without confirmation answer `FILE_WARNINGS_UNCONFIRMED`.
  - Confirmed warnings are written as the note of the `PUBLISHED` event.
- A draft stays editable while its files copy, so there are two guards:
  - **Finalize** refuses with `RELEASE_CHANGED` if the files, version or
    product differ from what was copied. Today it compares files only. This is
    the check that counts.
  - **Edits, uploads, file deletes and release delete** answer
    `409 RELEASE_PUBLISHING` while a job for that release is running
    (`isPublishing(releaseId)` on the in-memory job map, checked in
    `lockRelease` for draft mutations).
- Finalize locks `[DRAFT]` instead of `[IN_REVIEW]`. Archiving the previous
  version, the announcement emails and the cleanup are unchanged.

### Storage: one bucket, new prefixes

- `storage.utils.ts`:
  - `stagedKey` → `draftKey`: `draft/{uuid}/{name}`.
  - `releasedKey` → `publishedKey`:
    `publish/{productId}/{version}/{uuid}/{name}`. Its input pattern accepts
    `draft/…` and the two older `staged/…` forms.
  - New `isDraftKey` (`draft/` or `staged/`) and `isPublishedKey` (`publish/`
    or `releases/`). They replace every `startsWith("staged/")` and
    `startsWith("releases/")` in `downloads.service.ts`,
    `file-checks.service.ts` and `scripts/purge-releases.ts`.
- `configs/storage.ts`: `getStorageBuckets()` → `getStorageBucket(): string`
  (`OCI_BUCKET`, or `local` for the local driver). Publish copies inside the
  one bucket.
- Remove `OCI_STAGING_BUCKET` and `OCI_RELEASE_BUCKET` from `configs/env.ts`,
  `.env.example` and `scripts/storage-copy-smoke.ts`.

### Dashboard (`services/admin/dashboard.service.ts`)

- Remove `releaseAlerts` (the review queue). The rest is unchanged.

### Migration

`server/prisma/schema.prisma` plus one hand-written migration:

```sql
UPDATE "Release" SET "status" = 'DRAFT'
  WHERE "status" IN ('IN_REVIEW', 'CHANGES_REQUESTED');
ALTER TYPE "ReleaseStatus" RENAME TO "ReleaseStatus_old";
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'ROLLED_BACK');
ALTER TABLE "Release" ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ReleaseStatus" USING "status"::text::"ReleaseStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ReleaseStatus_old";
```

- Needs explicit approval before it runs anywhere (AGENTS.md).
- Test database: `npm run test:migrate`. Dev and production:
  `npx prisma migrate deploy`.

## Client

- **Permissions** (`pages/Releases/release-permissions.ts`):
  - ADMIN: no actions.
  - Any DEV: draft → `edit`, `publish`, `delete`; published → `editNotes`,
    `rollback`; archived → `rollback`.
  - Remove `submit`, `withdraw` and `reject`.
- **Statuses.** Drop `in_review` and `changes_requested` from
  `releases.types.ts`, `releases.mappers.ts`, `releases.filters.ts`,
  `releases.utils.ts`, `ReleaseStatusBadge.tsx`, `editor.state.ts` and
  `DraftsInProgress.tsx`. Event kinds stay, so old timelines still read
  correctly.
- **Badge.** Remove `needsYou` from `releases.model.ts`,
  `useReleaseQueries.ts`, `ReleasesPage.tsx` and the sidebar count in
  `StaffShell.tsx`.
- **Detail page** (`ReleaseDetailPage.tsx`, `ReleaseActions.tsx`):
  - Publish button and `PublishDialog` for a DEV on a draft; rollback and
    notes for a DEV.
  - The four check cards (`ReviewCards`) show to a DEV on a draft, as the
    pre-publish check.
  - The warnings dialog moves from submit to publish:
    `releasesApi.publish(id, { confirmWarnings })`. `SubmitWarningsDialog`
    becomes `PublishWarningsDialog` ("Publish anyway").
  - Remove the request-changes dialog, the feedback callouts and the "only
    the creator" hints.
- **Editor** (`EditRelease.tsx`, `NewRelease.tsx`): the main button becomes
  "Save and continue". It saves, then opens the detail page, where the checks
  and Publish are. Remove all "sent for review" and "an admin reviews"
  wording.
- **Publish jobs** (`features/uploads/uploads.store.ts`, `publish-poller.ts`,
  `usePublishJob.ts`): seeded for DEV instead of ADMIN. An interrupted job is
  detected by status `draft`.
- **Dashboard** (`DashboardPage.tsx`, `dashboard.api.ts`): remove the "Waiting
  for review" panel.
- `releases.api.ts`: remove `submit`, `withdraw` and `requestChanges`.

## Tests

- Server integration:
  - Rewrite `release-review.test.ts` and `release-workflow.test.ts` for the
    new flow.
  - Update `release-publish`, `releases`, `release-files`, `upload-sessions`,
    `release-file-checks`, `downloads`, `license`, `admin-dashboard`, the
    helpers and the `storage.utils` unit tests.
- New cases:
  - ADMIN gets 403 on every mutating release route, and 200 on list, get and
    download.
  - A second DEV can edit, publish and roll back another DEV's release.
  - Publish from a draft: blocked files refuse; warnings need
    `confirmWarnings`; the note is recorded.
  - An edit during a running publish gets `RELEASE_PUBLISHING`; a version
    change between copy and finalize gets `RELEASE_CHANGED`.
  - A file with an old `staged/…` key publishes; an old `releases/…` key
    still downloads.
- Client: `release-permissions.test.ts`, `releases.mappers.test.ts`,
  `releases.api.test.ts`, `uploads.store.test.ts`.

## Docs to update

- `AGENTS.md` fixed decisions: roles, buckets, release states.
- `server/docs/releases/release-management.md`, `review-cards.md`,
  `file-checks.md`, `operations/release-storage.md`, `admin/dashboard.md`,
  `downloads/downloads.md`, `architecture.md`.
- `docs/development-document.md` and `docs/user-guide.md` (developer and admin
  sections), then the two shared Claude Docs.
- OpenAPI: `scripts/openapi-releases.ts`, then `npm run docs`.

## Deploy

- If production sets two different buckets today, copy every object from both
  into `OCI_BUCKET` (same keys) before this ships. Otherwise old downloads and
  drafts break.
- Run the migration before starting the new API build.

## Verification

- `npm run test:migrate`, then `npm run test` and `npm run lint` in `server/`.
- `npm run test`, `npm run lint` and `npm run build` in `client/`.
- By hand, with `npm run dev` on both sides:
  - As a DEV: create a draft, upload, save, publish from the detail page and
    watch the progress. The object lands under `publish/…` and the draft
    object is gone. Then roll it back.
  - As a second DEV: edit and publish the first DEV's draft.
  - As an ADMIN: releases open read-only with no buttons; the dashboard has no
    review panel.
  - As a customer: the published file downloads, and so does a file published
    before the change (key `releases/…`).
