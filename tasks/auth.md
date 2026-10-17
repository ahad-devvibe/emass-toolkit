# Auth v2 — signups, domain policy, set-password, MFA

Status: in progress (started 2026-10-17)
Supersedes: the materialized auth flow (password-at-signup + SIGNUP_VERIFY OTP) from
`docs/auth/auth-module.md` — that doc gets updated when this lands.

## What was built

Auth flows for the EMASS-Toolkit portal: policy-routed signups (no password at
signup), admin approval queue for free-mail domains, a 48h set-password email
link (with a 24h reminder) as the verification for custom/corporate domains,
distorted-text captcha on signup, and email-OTP MFA for DEV/ADMIN logins.

## Flows

### Signup (`POST /api/auth/signup`)

Form fields: `email` (work email), `firstName`, `middleName?`, `lastName`,
`country` (ISO 3166-1 alpha-2), `companyName`, `jobTitle`, `captcha` (typed
code). **No password field.**

Domain policy (email domain checked against `EmailDomainPolicy` table):

| Domain class          | Behavior                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| COMPETITOR (DB list)  | `403 DOMAIN_BLOCKED`, no account created                                                             |
| FREE_MAIL (DB list)   | account created `PENDING_APPROVAL` → "pending review" email; no set-password link until admin approves |
| custom / anything else| account created `PENDING_SET_PASSWORD` → set-password email = the verification (no OTP)              |

- Unique-email collisions → `409 EMAIL_TAKEN` (email existence is acknowledged;
  acceptable for this MVP).
- Admin-created accounts (future ops path) are out of scope.

### Set password

- `GET /api/auth/set-password/:token` — look up the invite (returns email +
  expiry, or `SET_PASSWORD_TOKEN_INVALID` / `SET_PASSWORD_EXPIRED`) so the UI
  can render the form.
- `POST /api/auth/set-password` `{ token, password }` — sets password,
  marks email verified, status → `ACTIVE`, consumes the token, deletes the
  user's other set-password tokens. Password min 6 / max 72 (same as before).
- `POST /api/auth/resend-set-password` `{ email }` — if `PENDING_SET_PASSWORD`,
  issues a fresh token + email (re-extends to 48h from now).
- Token: `randomBytes(32)` base64url, **sha256-hashed at rest**, TTL from
  `SET_PASSWORD_TTL_HOURS` (default 48), single-use.

### 24h reminder (cron)

- In-process `node-cron` sweep every 30 minutes (started in `server.ts`, never
  in tests): tokens where `consumedAt IS NULL`, `reminderSentAt IS NULL`,
  `createdAt <= now - SET_PASSWORD_REMINDER_HOURS` (default 24), `expiresAt > now`
  → send reminder email with the **original link** (no expiry extension) and set
  `reminderSentAt`. Exactly one reminder per token.
- Expiry is enforced lazily at redemption (no cleanup job needed for MVP).

### Login

- `POST /api/auth/login` `{ email, password }`
  - bad password → `401 INVALID_CREDENTIALS`
  - `BLOCKED` → `403 ACCOUNT_BLOCKED`; `PENDING_APPROVAL` →
    `403 ACCOUNT_PENDING_APPROVAL`; `PENDING_SET_PASSWORD` →
    `403 ACCOUNT_NOT_ACTIVE`
  - CUSTOMER + ACTIVE → tokens issued (cookies + body)
  - DEV/ADMIN + ACTIVE → MFA OTP emailed, response `{ mfaRequired: true }`,
    **no tokens, no cookies**
- `POST /api/auth/verify-otp` `{ email, code, purpose: MFA_LOGIN }` → tokens
  (DEV/ADMIN only, ACTIVE). MFA on every login; no remember-device.
- `POST /api/auth/resend-otp` `{ email, purpose: MFA_LOGIN }` re-issues.
- Forgot/reset password unchanged (OTP `PASSWORD_RESET` for all roles).

### Admin approval queue (`/api/auth/admin/...`, ADMIN only)

- `GET /signups/pending` — all `PENDING_APPROVAL` users
- `POST /signups/:id/approve` — status → `PENDING_SET_PASSWORD` + set-password
  email (48h token)
- `POST /signups/:id/reject` — status → `BLOCKED`

### Captcha

- `GET /api/auth/captcha` → `{ image: <data-uri> }` + httpOnly HMAC-signed
  cookie (TTL 10 min) holding sha256 of the expected 6-char code.
- 6-char distorted text (`svg-captcha`, ambiguous chars removed from alphabet),
  case-insensitive compare, cookie cleared on successful verify. Required on
  signup (reusable on login/forgot-password later).

## Key decisions

- Set-password link replaces the SIGNUP_VERIFY OTP flow → `OtpPurpose` is now
  `MFA_LOGIN | PASSWORD_RESET` only.
- Roles renamed `USER → CUSTOMER` (`DEV`, `ADMIN` unchanged).
- Domain lists live in DB (`EmailDomainPolicy(kind FREE_MAIL | COMPETITOR)`),
  seeded; admin CRUD endpoints are follow-up work, not this pass.
- Captcha uses `svg-captcha` (pure JS, zero native deps, battle-tested widget)
  — chosen over a hand-rolled PNG for reliability.
- Reminder via in-process cron; no queue/Redis for MVP.

## Assumptions

- "Free mail → approved list" = waitlist pending admin approval before any
  password can be set (confirmed).
- Reminder at 24h carries the original link; no expiry refresh (confirmed).
- Competitor seed: one dummy domain (`blocked-competitor.example`).
- Free-mail seed: gmail.com, yahoo.com, outlook.com, hotmail.com, icloud.com,
  aol.com.
- Signup enumerates existing emails via `EMAIL_TAKEN` (accepted).
- Country is stored as ISO alpha-2; the dropdown list itself is a frontend
  concern (backend validates 2-letter code).

## Risks / follow-ups

- Rate limiting on signup/login/forgot-password/captcha (not built yet).
- Admin CRUD for domain lists; rejection notification email.
- "Remember device" MFA (explicitly out for MVP).
- Migration/`db push` against real DBs still needs an explicit go command
  (schema changed here; `prisma generate` only so far).
- Existing integration suites must be rewritten for the new flow (in progress).
