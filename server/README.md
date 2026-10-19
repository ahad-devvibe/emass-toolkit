# EMASS-Toolkit — Backend

Node/Express/Prisma/PostgreSQL API for the EMASS-Toolkit gated download
portal: auth (OTP-verified signup, JWT + rotating refresh, roles
`USER`/`DEV`/`ADMIN`), console/OCI email delivery, and private OCI object
storage with short-lived PAR download URLs.

## Stack

- Node.js + Express 5, TypeScript (ESM)
- Prisma 7 + PostgreSQL
- Zod 4 (DTO validation + env validation)
- pino logging, ESLint 9 + Prettier
- Vitest + Supertest (real `_test` Postgres)
- OCI SDKs: `oci-objectstorage`, `oci-emaildataplane`

## Quickstart

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL + JWT_SECRET
npx prisma migrate dev      # create schema (requires approval in this repo)
npm run dev                 # http://localhost:5000/api/health
```

Tests:

```bash
cp .env.test.example .env.test   # *_test DATABASE_URL, JWT_SECRET
npm run test:migrate             # migrate the test DB (requires approval)
npm run test
```

## Commands

| Command                             | Purpose                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                       | dev server (tsx watch)                                         |
| `npm run test` / `test:integration` | Vitest against the test DB (`_test`, injected via `.env.test`) |
| `npm run lint` / `lint:fix`         | ESLint                                                         |
| `npm run format`                    | Prettier write                                                 |
| `npm run docs`                      | regenerate OpenAPI spec + Redoc HTML                           |

## Modules

- **auth** — `/api/auth/*`: signup + OTP verification, login, refresh/logout
  (rotating refresh tokens), forgot/reset password, `me`, role middleware.
  See `docs/auth/auth-module.md`, `docs/auth/password-reset.md`.
- **email** — console sender by default, OCI Email Delivery when
  `EMAIL_PROVIDER=oci` (templates in `src/services/email/templates/`).
- **storage** — generic private-bucket object ops (`uploadObject`,
  `deleteObject(s)`, `copyObject`) and 60-second read-only PAR URLs
  (`getObjectUrl`). Uploads via multer (`src/middleware/upload.ts`).

## Notes

- This repo keeps 18 legacy Held migrations for history; the spliced schema no
  longer matches them (accepted drift). Recommended: wipe them into one clean
  `init` migration — pending approval. `npm run test:migrate` is likewise
  gated until then.
- Bruno collection in `bruno/starterkit/` (health + Auth) for manual API runs.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full system design —
stack, contracts, error handling, and testing strategy.
