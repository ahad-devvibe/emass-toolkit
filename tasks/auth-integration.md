# Auth integration (client ↔ server)

Status: Phase 1 implemented (2026-10-19), pending manual browser QA. Phases 2–4
not started.

## Phases

1. **Foundation, sign up, sign in** (done, needs QA): see below.
2. **Password recovery:** forgot-password → OTP → new password pages; resend
   flows.
3. **Admin sign-up queue** (implemented 2026-10-19, needs QA):
   - `/admin/signups` (ADMIN only) lists `PENDING_APPROVAL` sign-ups, oldest
     first, with approve and reject.
   - Reject takes an optional reason (≤500 chars). The person gets a
     best-effort "request not approved" email that includes the reason. The
     reason is not stored, so there's no migration.
   - One shared client store (`pendingSignups.store.ts`) feeds both the page
     and the admin sidebar badge.
   - The list is cursor-paginated (keyset on `createdAt, id`; `limit` 1–50,
     default 20) with name/email search (`q`; every word must match). The
     page uses infinite scroll and keeps the search in `?q=`. The badge shows
     the full queue size via `limit=1`.
   - Follow-up (needs migration approval): `@@index([status, createdAt, id])`
     on `User` once the queue grows.
4. **Hardening:**
   - Rate limits on login, OTP, signup and forgot-password.
   - `forgot-password` enumeration (404 `USER_NOT_FOUND`).
   - Production CORS origin allowlist via env; cookie `sameSite` for a
     cross-site deploy.
   - A client test runner (Vitest) for `auth/session.ts`.
   - Route code splitting.

## Phase 1: what changed

**Server**

- **Refresh token is cookie-only:**
  - httpOnly, path `/api/auth`, so `/logout` receives it and revokes it.
  - Removed from login, verify-otp and refresh bodies. A body token is ignored.
  - The unused readable `accessToken` cookie was removed.
  - The legacy `/api/auth/refresh` cookie path is cleared on issue and logout.
- **`issueTokenPair` cleanup:**
  - Prunes the user's expired tokens and tokens revoked more than 24h ago
    (`REUSE_DETECTION_WINDOW_MS`).
  - Recently revoked rows stay, so a replay still returns
    `REFRESH_TOKEN_REUSED`. Before this, every revoked row was deleted and
    reuse detection never fired.
  - The nested `$transaction` call on an interactive transaction client is
    gone.
- **CORS:** a disallowed origin gets `403 CORS_ORIGIN_DENIED` in the standard
  error envelope (was a 500).
- **`npm run seed:users`:**
  - Reads the gitignored `data/staff-users.json` (template:
    `data/staff-users.example.json`).
  - Idempotent upsert by email: ACTIVE, bcrypt-hashed password.
  - Never deletes. `--dry-run` writes nothing; `--reset-passwords` overwrites
    existing passwords.
  - Data only, no migration.
- **Tests, spec and docs:**
  - Integration tests cover the cookie-only refresh, rotation, reuse revoking
    all tokens, the concurrent-refresh race, logout revocation and CORS.
  - Unit test for the pruning rule.
  - OpenAPI spec regenerated; `docs/auth/auth-module.md` updated.

**Client**

- **`vite.config.ts`:** proxies `/api` to `VITE_API_TARGET`
  (default `http://localhost:5000`). Being same-origin keeps the
  `sameSite=strict` cookie working on localhost and the LAN URL.
- **`lib/api/http.ts`:** `apiRequest` + `ApiRequestError` (status, code,
  fieldErrors).
- **`auth/session.ts`:**
  - The access token lives in memory only.
  - **Single-flight refresh per device:**
    - Within a tab, callers share one promise.
    - Across tabs, the refresh runs under a Web Lock, with a localStorage
      lease fallback on plain-http LAN where Web Locks don't exist.
    - The new token is broadcast on `BroadcastChannel`, and a tab that waited
      on the lock reuses it.
  - A 401 on refresh ends the session in every tab.
  - `authorizedRequest` refreshes ahead of expiry (30s skew) and retries once
    on `TOKEN_EXPIRED`/`TOKEN_INVALID`.
- **`AuthProvider`:**
  - `status` is loading, authenticated or anonymous.
  - Boot: refresh then `/me`, only when the `emass-has-session` hint is set.
  - Also `signIn` (with `mfaRequired`), `verifyMfa`, and `signOut`, which
    revokes the token server-side.
- **Pages:**
  - Sign in, with an MFA code step for DEV/ADMIN and "resend set-password"
    for `ACCOUNT_NOT_ACTIVE`.
  - Sign up (`/sign-up`), with captcha and country select.
  - Set password (`/set-password?token=`), with an expired-link resend.
  - Shared `AuthLayout`, `FormField`, `PasswordInput`, `PageLoader`.
- **Removed:** the demo accounts and the demo panel.

## Decisions / risks

- **Revocation counts as reuse:** a token revoked by logout also counts as
  "reused". Replaying a logged-out cookie revokes all of that user's sessions.
  That's intended (it means the cookie was stolen).
- **Lease fallback isn't atomic:** the localStorage lease is not atomic like
  Web Locks. Write-then-confirm makes collisions unlikely, not impossible.
  Serve over HTTPS (or localhost) in production so Web Locks are used.
- **Lost access token on reload:** the access token is gone on reload, and boot
  costs one refresh per tab, serialised by the lock.
- **Test DB blocked:** server integration tests can't run until `.env.test` has
  working Postgres credentials (28P01).
