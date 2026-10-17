## Project

EMASS-Toolkit - Gated download portal for Nanoveu's EMASS SDKs, and docs. Approved customers/engineers log in and
download versioned files. This is an MVP: keep it simple.

## Stack

- React.js + Node.js + Express, TypeScript (ESM)
- Prisma + PostgreSQL
- Vitest + Supertest for testing, real Postgres test DB (not sqlite/mocked)
- OCI Object Storage. Deployed directly on OCI VM (no managed service)

## Architecture

- /src/configs - application-level configs (prisma, env validation, logger, etc.)
- /src/routes - Express route handlers, thin, no business logic
  - `*.routes.ts` suffix for all route files
  - `src/routes/index.ts` is the explicit loader (mounted at `/api`)
- /src/controllers - routes call controllers (`*.controller.ts` suffix)
- /src/services - business logic, called by controllers
  - /{service}/{service}.utils.ts - pure functions specific to that service
  - /{service}/{service}.service.ts - main service logic
- /src/middleware - Express middleware (`*.middleware.ts` suffix)
- /src/utils - truly cross-cutting helpers only (used by 2+ unrelated services) (`*.utils.ts` suffix)
- /src/schemas - zod DTO schemas (`*.schema.ts` suffix)
- /prisma - schema, migrations

## Fixed decisions

- Roles: `dev` can stage a release; `admin` can approve, publish and roll back.
  Enforce roles on the server, never only in the UI.
- Files: private OCI bucket, never public. A release file is never overwritten;
  every version is a new object.
- Downloads: user gets a 1h token from our DB; on click we check it, log the
  download, then redirect to an object-level, read-only OCI PAR (~60 seconds).
  OCI access uses an instance principal, no keys on disk.
- Checksums: we compute SHA-256 on upload, store it per file, show it next to
  the download.
- Release states: staged -> published -> archived. Publishing archives the
  previous version. Rollback restores it and emails everyone who downloaded the
  bad build.
- Catalog: the two products are defined in code. Versions and files live in
  Postgres.
- HubSpot: used only to create/update customer contacts, one-way from our
  portal. Never read business logic from it. Download and activity logs live in
  our database.

## Conventions

- API responses: `{ success, statusCode, message, data? }` on success,
  `{ success: false, statusCode, message, code, details? }` on error —
  ApiResponse / ApiError classes, always. `data` is omitted when a response
  carries no payload.
- Validation: Zod schemas per route, colocated in /src/schemas. Every required
  field distinguishes "missing" vs "wrong type" in its error message (see
  the zod-schemas skill).
- Env vars are validated by `src/configs/env.ts` (zod) — fail fast at boot.
- Service-specific pure functions live in {service}/{service}.utils.ts, not global /src/utils.
  Promote to /src/utils only when a second, unrelated service needs the same function.
- Never run prisma migrations without explicit approval.

## Testing

- resetDb() must never truncate `_prisma_migrations` — breaks `migrate deploy` on
  the test DB with P3018.

## Error handling

- All thrown errors must be ApiError instances (statusCode, message, code, details?).
- Catch and translate known Prisma errors (P2002, P2025, etc.) in the SERVICE layer,
  where context is known (e.g. "email already exists" not "duplicate entry").
  Central errorHandler middleware handles any Prisma errors NOT caught in the service
  layer as a generic fallback — never let raw Prisma/Node errors reach the client.
- Unknown errors: log full detail server-side (pino logger), return generic
  `{ success: false, statusCode: 500, message: "Internal server error", code: "INTERNAL_ERROR" }`.
- No manual try/catch needed in controllers (Express 5 forwards async rejections automatically) —
  try/catch belongs in services, specifically to translate known errors into ApiErrors.

## Testing approach

- Integration-first (Supertest + real test DB), not unit-heavy
- Unit tests only for pure logic
- Every route touching user-scoped data must have a test proving cross-user access fails
- Test file layout:
  - `tests/integration/` — ALL Supertest/app-level tests (DB-touching or not)
  - `tests/unit/` — pure logic only
  - `tests/helpers/` — shared test utilities (resetDb, factories)
  - Nothing flat at `tests/` root
- Every DB-touching test file must start with `beforeAll(resetDb)` — never rely on
  test ordering or manual cleanup; non-DB test files stay DB-free
- Integration files run serially (`fileParallelism: false` in vitest.config.ts) so
  concurrent truncation can't wipe another file's data mid-run

## Testing DB

- Tests run against a separate Postgres DB (`starterkit_test`), injected via
  dotenv-cli from `.env.test` — never .env.
  Scripts: `npm run test` (everything), `npm run test:integration` (integration dir),
  `npm run test:migrate` (migrate the test DB schema).
- vitest.setup.ts refuses to run if DATABASE_URL doesn't contain "\_test" — this is intentional,
  don't remove it. If you see this error, you're loading the wrong env file.
- Tables are truncated before each test file via resetDb() — don't rely on test ordering
  or manual cleanup in individual tests.
- The test DB is only truncated, never dropped; the dev DB is never touched.

## Commands

- `npm run test` / `npm run test:integration`
- `npm run lint` / `npm run format`
- `npm run dev`

## Workflow: task completion

When a task in tasks/ is marked complete, convert it into a docs/ entry —
do not skip even for small tasks, this is the project's only permanent
record of decisions/risks/assumptions. Then delete or archive the task
file from tasks/.

- Module/feature tasks: follow docs/\_template.md, placed at
  docs/{module}/{task-name}.md.
- Non-module docs (architecture, operations, API reference, etc.): use a
  bespoke structure defined at prompt time when the doc is created — no
  template. Keep them concise, production-grade, and maintained (e.g.
  docs/architecture.md is updated whenever a dependency or structural
  decision lands).
