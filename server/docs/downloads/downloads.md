# Downloads

## What was built

The Download buttons on the customer product page now work. A click calls `POST /api/catalog/files/:fileId/download`. The server:
1. checks the file is shipped;
2. creates a **read-only, object-level OCI pre-authenticated request (PAR)** valid for 1 hour (`DOWNLOAD_URL_TTL_SECONDS`, default 3600);
3. records a `Download` row;
4. returns `{ url, expiresAt, fileName }`.

The browser then saves the file straight from storage.

**Staff** (DEV and ADMIN) download from the release page with `POST /api/releases/:id/files/:fileId/download`, in **any** release state:
- **Staged files** (draft, in review, changes requested) get a 5-minute link to the staging bucket (`STAGED_DOWNLOAD_URL_TTL_SECONDS`).
- **Shipped files** get the normal 1-hour link.

- **Code:**
  - `src/services/downloads/downloads.service.ts`;
  - `createReadUrl` in the storage drivers;
  - the routes in `catalog.routes.ts` (customers) and `releases.routes.ts` (staff);
  - tests in `tests/integration/downloads.test.ts` and the unit tests for the OCI driver and storage utils.
- **Client:** `catalogApi.downloadFile` (`ProductDetailsPage.tsx`) and `releasesApi.downloadFile` (`ReleaseDetailPage.tsx`), both through `downloadFromServer` in `lib/download.ts`.

**Licence click-through:** before a customer's first download, the product page shows the EMASS Software Licence in a dialog. It covers use, no redistribution, no reverse engineering, ownership and warranty. Accepting is recorded once per account (`User.licenseAcceptedAt`, `User.licenseVersion`). The endpoints are `GET /api/catalog/license` and `POST /api/catalog/license/accept`. The wording lives in `src/services/licenses/license.terms.ts`.

## Key decisions

- **1-hour links (changed from ~60 s, at the client's request; AGENTS.md updated).** OCI checks a PAR only when a download starts, so long downloads finish either way.
  - **Cost:** a copied link works for anyone for up to an hour.
  - **Mitigations:** every click mints a new link; links are object-level, read-only and never listable; and every click is logged with the user.
- **Who can download:** any signed-in user (`requireAuth`), with the same visibility as the catalog: `PUBLISHED` and `ARCHIVED` releases of active products.
  - Drafts, reviews and rolled-back builds, inactive products, and unknown or malformed ids all give the same `404 FILE_NOT_FOUND`.
- **Staged objects are staff-only:** the customer endpoint also requires the key to start with `releases/`. The staff endpoint picks the bucket from the key prefix (`staged/` → staging, short TTL; `releases/` → release) and refuses anything else. (AGENTS.md updated: it used to forbid any staged PAR.)
- **Order:** mint the link, then record the download; the link is returned only once the row exists. A link minted for a failed insert just expires unused.
- **Two logs, no role column:**
  - **`Download` is customers only:** who got our files, used for rollback emails and counts.
  - **Staff downloads go to `ActivityLog`** (`FILE_DOWNLOADED`, with `releaseId`, `releaseFileId` and `details: { fileName, staged }`), including staff using the customer page. Testing a build never counts as a download.
- **`Download` rows:** `userId`, `releaseFileId` and a denormalised `releaseId`, indexed `(releaseId, userId)`, so "who downloaded this build" (for rollback emails) is one query. `resourceId` is reserved for product resources.
- **The local driver** (dev and tests) stands in for OCI with a signed link, `GET /api/files/local/:token`:
  - the token is an HMAC with `JWT_SECRET` over bucket, key, file name and expiry;
  - the route is mounted only when `STORAGE_DRIVER=local`;
  - a bad or expired token gives `403 DOWNLOAD_LINK_INVALID`.

- **Licence:**
  - **Enforced on the server:** a customer download with no acceptance is refused with `409 LICENSE_REQUIRED` before any link is made or anything is logged.
  - **Once per account:** no re-prompt per version, by the client's decision. The first acceptance (time and wording version) is kept, so a repeat accept changes nothing.
  - **Staff are exempt:** they get `accepted: true` and are never blocked.
  - **Kept off user responses:** the acceptance fields never appear in user responses (`presentUser`).
- **Terms on the auth pages:** sign-in and sign-up show "By signing in / requesting access, you agree to the Terms of Use and Data Protection Policy", linking to nanoveu.com. It's a notice only; nothing is recorded.

## Assumptions

- **The licence wording is a draft pending legal sign-off.** Legal edits `license.terms.ts` and bumps `LICENSE_VERSION`. Customers who already accepted aren't asked again (once per account); their stored version shows which wording they saw.

- The OCI policy for the instance principal allows `PAR_MANAGE` on the release bucket. Without it, clicks fail with `502 DOWNLOAD_URL_FAILED` (logged).
- **The saved file name on OCI comes from the object key** (`safeName` of the original), since a PAR can't set `Content-Disposition`. The local driver uses the original name.

## HubSpot

Each customer download also updates the totals kept on the user: count, and first and last date and file. This happens in the same transaction as the `Download` row, so it's constant time. Those stored values are then pushed to the HubSpot contact, with a first-download note sent once. If HubSpot fails, the customer's next download or `npm run hubspot:resync` repairs it. See the HubSpot section of `docs/auth/auth-module.md` and `docs/operations/hubspot-setup.md`. Staff downloads change none of this.

## Risks / follow-ups

- **PARs pile up** in the bucket's PAR list until they expire (OCI cleans up expired ones); there's one per click.
- **Rollback emails are built:** see the Rollback bullet in `docs/releases/release-management.md`.
- A dashboard downloads count and "recent downloads" can now be built on `Download`.
- **Product resources** (`ProductResource`) still have no upload or download flow.
