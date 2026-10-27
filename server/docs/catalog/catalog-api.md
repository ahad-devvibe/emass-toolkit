# Customer catalog API

## What was built

A read-only catalog for the customer pages (`/catalog` and
`/catalog/:productId`), which no longer use mock data (2026-10-23).

| Endpoint | Returns |
|---|---|
| `GET /api/catalog/products` | Active products in `sortOrder`, each with `latest: { version, publishedAt, platforms[] }` (its `PUBLISHED` release) or `null` |
| `GET /api/catalog/products/:id` | `{ product, versions, resources }`: the product (with `detail`), its shipped versions with notes and files, and `resources: []` |
| `POST /api/catalog/files/:fileId/download` | Records the download and returns `{ url, expiresAt, fileName }`, a 1-hour read-only link (see `docs/downloads/downloads.md`) |

- **Code:**
  - `src/services/catalog/catalog.service.ts`, with `catalog.controller.ts`, `catalog.routes.ts` and `catalog.schema.ts`;
  - tests in `tests/integration/catalog.test.ts`.
- **Client:**
  - `client/src/pages/Catalog/catalog.api.ts` turns the responses into the existing UI types;
  - the hooks live in `useCatalog.ts`.

## Key decisions

- **Only shipped releases are visible:** `PUBLISHED` (the current one, always first), then `ARCHIVED`, newest version first.
  - **Never returned:** `DRAFT`, `IN_REVIEW`, `CHANGES_REQUESTED` and `ROLLED_BACK`.
  - **Rolled-back builds:** a rolled-back build is withdrawn, so customers can't pick it, even as an old version.
- **Any signed-in role can read it** (`requireAuth`). Staff see exactly what customers see. Pending, rejected and blocked accounts can't sign in, so they never reach it.
- **Files carry what the page needs:** `id`, `kind`, `platform`, `name`, `sizeBytes` (a number, since files are capped far below 2^53) and `sha256`.
  - `objectKey`, content type and staff ids are never sent.
- **Errors:**
  - an inactive product, an unknown id or a malformed id → `404 PRODUCT_NOT_FOUND` (a malformed id can't match, as with releases);
  - signed out → `401`.
- **`resources` is always `[]`** until product resources can be uploaded. The response shape is already final, and the client hides the section while it's empty.
- **`/api/products` stays as it is:** it's the staff release editor's product picker and returns names only.

## Assumptions

- **Archived versions stay downloadable** for customers once downloads exist. That's why they appear in the version picker, with an "archived release" notice.
- **No architecture field:** the schema has one SDK build per platform and no architecture, so the old mock's "x64 / arm64" labels are gone. The file format comes from the file name.

## Risks / follow-ups

- **Downloads:** built (`docs/downloads/downloads.md`). "Recent downloads" and the rollback emails are still to do.
- **Product resources:** they need an upload flow (`ProductResource` has no service yet).
- **No caching:** every page view queries the database. That's fine at this size; add HTTP caching only if needed.
