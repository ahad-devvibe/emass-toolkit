# Review status cards (admin, in review)

Status: planned (2026-10-27)

## Goal

When an admin opens a release that is **in review** (`/releases/:id`), a short
row of status cards appears. Everything comes from what `GET /api/releases/:id`
already returns: no API change, no migration, no server re-verify.

## Decisions

- **No "version match" card.** Upload already blocks installers with the wrong
  version (`VERSION_MISMATCH` / `VERSION_EXISTS` in
  `server/src/services/releases/file-checks.utils.ts`), so the card would always
  say "matched".
- **No "checksum" card.** The browser sends a SHA-256 and the server recomputes
  it while streaming, rejecting any mismatch (`release-files.service.ts`,
  `checksumMismatch`), so the card would always say "verified".
- **No server "re-verify checksums" endpoint for the MVP.** A true check against
  the bucket would download every file on each run.
- **Only admins see the cards, and only while the release is in review.** The
  cards are display only; the server already enforces roles for the actions.

## Cards

1. **Version bump**
   - Compares `release.review.currentPublished` with `release.version` using
     `parseSemver` (`client/src/pages/Releases/version.utils.ts`).
   - Shows "v1.3.0 → v1.4.0" with a sub-label of major / minor / patch.
   - Shows "First release" when nothing is published yet.
2. **Platforms**
   - Shows the count from `supportedOs(files)`
     (`client/src/pages/Catalog/catalog.meta.ts`) with `osMeta` icons.
   - Neutral colour. The sidebar Summary stays as it is.
3. **Integrity**
   - Checks that no file has a `DAMAGED` or `SAME_CONTENT` code in `blockedBy`.
   - Green: "All files intact". Red: "N files flagged". The existing red box
     already lists the details.

## Implementation

- **`client/src/pages/ReleaseDetail/release-detail.utils.ts`:** add pure helpers,
  with unit tests next to the existing tests for this file:
  - `bumpKind(from, to)`: returns `"major" | "minor" | "patch" | null`;
  - `integrityIssues(files)`: returns the files with `DAMAGED` or `SAME_CONTENT`
    blocks.
- **New `client/src/pages/ReleaseDetail/components/ReviewStats.tsx`:**
  - a local `StatCard` (icon, label, value, optional tone), styled like the
    existing cards (`rounded-xl border bg-card p-4`);
  - a grid that is 1 column on mobile and 3 on `sm` and up.
- **`client/src/pages/ReleaseDetail/ReleaseDetailPage.tsx`:**
  - render `<ReviewStats release={release} files={files} />` under the header,
    before the warning boxes;
  - only when `release.status === "in_review" && user.role === "ADMIN"`, the same
    condition as the "Waiting for your review" box.

## Verification

- In `client/`, run `npx tsc -b`, `npx eslint src`, `npx vitest run` and
  `npm run build`.
- Manual checks:
  - **As admin, on an in-review release:** all 3 cards show. The bump label is
    correct, and a first release shows "First release".
  - **As developer, or in any other state:** no cards.
