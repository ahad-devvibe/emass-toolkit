# Release workflow dashboard (dev / admin)

Status: implemented, pending manual QA (2026-10-19). Typecheck, lint and build
pass.
Scope: `client/` only. Mock data is in memory and nothing touches the server.

## Flow

| Status | Shown as | Reached by | Who |
| --- | --- | --- | --- |
| `draft` | Draft | Save draft · Withdraw | dev, admin |
| `in_review` | In review (AGENTS.md "staged") | Submit for review | dev, admin |
| `changes_requested` | Changes requested | Request changes + required feedback | admin |
| `published` | Published | Publish; also archives the product's current published release | admin |
| `archived` | Archived | Superseded by a newer publish | system |
| `rolled_back` | Rolled back | Roll back + required reason; the newest older archived release is restored to published | admin |

- Devs and admins can edit, submit or delete releases in `draft` and
  `changes_requested`, and can withdraw `in_review` releases.
- Admins can also publish, request changes and roll back. Admins can do
  everything a dev can.
- Every transition appends an event (actor, time, optional note), shown in an
  Activity timeline.

## What was built

- **Routes:**
  - `/releases`: list with status tabs and a product filter, driven by the URL.
  - `/releases/new` and `/releases/:id/edit`: the editor.
  - `/releases/:id`: the release detail page.
  - The staff routes are wrapped in `RequireRole(["DEV","ADMIN"])`.
  - Sign-in and the `*` fallback go to the role's home through `RoleHome`:
    `/releases` for staff, `/catalog` for customers.
- **Staff shell:**
  - Real navigation: Releases; Review queue (admin only, with a pending
    count); Customer view.
  - A breadcrumb, a "New release" button, and a mobile navigation sheet.
- **Editor** (`pages/ReleaseEditor/`):
  - Product and version fields. Versions are validated as semver, must be
    unique per product, and must be newer than the highest version ever
    shipped. Patch, minor and major suggestion chips are offered.
  - Drag and drop or a file picker.
  - Uploads are simulated with a progress bar. The SHA-256 is computed in
    the browser with `crypto.subtle`.
  - Each file's type, OS and arch (SDKs) or title (documents) is
    auto-detected from the filename (`detect-file.ts`), with
    Auto-detected / Edited / Needs mapping / Duplicate tags. The uploader can
    re-map any of them.
  - Markdown release notes with Write and Preview tabs.
  - A "Ready to submit?" checklist in the right rail lists what still blocks
    saving or submitting.
- **Detail page** (`pages/ReleaseDetail/`):
  - Banners for feedback, awaiting review and rollback.
  - Files reuse the customer `ReleaseFiles`/`FileRow`; unmapped files are
    listed separately.
  - The right rail has a role-based Actions panel, a Summary and Activity.
  - Publish, Request changes, Roll back and Delete each confirm in a dialog.
    Request changes and Roll back need text.
  - Publish is blocked when files are incomplete or the version is not newer
    than what has already shipped (for example, a pending 2.4.1 after 2.5.0
    ships).
- **State:**
  - `pages/Releases/ReleasesProvider.tsx` uses `useReducer` and is seeded
    by `releases.seed.ts`.
  - The seed is the catalog history plus three in-flight examples: Core 2.5.0
    in review, Core 2.4.1 with changes requested, and Vision 1.9.0 as a draft
    with an unmapped file.
- **Other:**
  - `StatusBadge` has the workflow statuses.
  - New `ui/textarea.tsx`.
  - `formatBytes` and `parseSize` were added to `release.utils.ts`.

## Decisions

- The data lives **in memory only** (user's choice). A page reload resets it.
  Signing out and in doesn't reload, so dev → admin can be walked in one
  session.
- The **customer catalog keeps its static data**. Publishing in the dashboard
  doesn't change `/catalog` until the API exists.
- **Rollback emails** go to everyone who downloaded the bad build. Download
  tracking doesn't exist yet, so the dialog shows a stable mock count
  (`mockDownloadCount`).
- Role checks in the UI (`release-permissions.ts`, `RequireRole`) are UX
  only. The server must enforce the same rules.

## Risks / follow-ups (server)

- **Prisma models:**
  - `Release`: productId, version, status, releaseNotes, createdBy.
  - `ReleaseFile`: kind, os, arch, title, format, sizeBytes, sha256, object
    key.
  - `ReleaseEvent`: type, actorId, note, createdAt.
  - Plus a unique (productId, version) constraint.
  - **Migration needs explicit approval.**
- **API:**
  - Endpoints for create, update, submit, withdraw, publish, reject and
    rollback.
  - Publish and rollback must be transactional (archive or restore
    together).
  - Role checks: dev stages; admin publishes, rejects and rolls back.
- **Uploads:**
  - Pre-authorized or proxied upload to the private OCI bucket, one new
    object per file, never overwritten.
  - The server computes the SHA-256. The browser hash is only a preview, and
    it reads the whole file into memory, so it's too heavy for very large
    builds.
- **Download tracking** feeds the rollback recipient list and the rollback
  email template.
- The main bundle is now 207 kB gzipped. Route-level code splitting is due.
