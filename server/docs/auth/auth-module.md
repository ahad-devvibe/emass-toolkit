# Auth module

## What was built

The complete auth stack for the EMASS-Toolkit API: policy-routed signups
(no password at signup), a 48h set-password email link as the verification for
custom/corporate domains, an admin approval queue for free-mail signups,
distorted-text captcha, login (customers: password; DEV/ADMIN: + email-OTP MFA),
rotating DB-backed refresh tokens, and OTP-based password reset — routes under
`/api/auth` plus `/api/auth/admin`. See `tasks/auth.md` for the original spec.

## Key decisions

- **No password at signup.** Signup form: work email, firstName, middleName?,
  lastName, country (ISO alpha-2), companyName, jobTitle + captcha. The account
  is created in a pending state.
- **Domain policy** (`EmailDomainPolicy` table, seeded via `npm run seed:domains`):
  - COMPETITOR (seed: `blocked-competitor.example`) → `403 DOMAIN_BLOCKED`,
    no account created.
  - FREE_MAIL (seed: gmail/yahoo/outlook/hotmail/icloud/aol) →
    `PENDING_APPROVAL`; admin approval (`/auth/admin/signups/*`) later sends
    the set-password email.
  - anything else (custom/corporate) → `PENDING_SET_PASSWORD` + set-password
    email immediately. **The set-password link is the email verification** —
    no signup OTP.
- **Set-password token**: random 32 bytes, sha256-hashed at rest, TTL
  `SET_PASSWORD_TTL_HOURS` (48), single-use; redeeming sets the password,
  marks email verified, activates the account.
- **24h reminder** (`node-cron` sweep every 30 min, started in `server.ts`,
  skipped under test): because tokens are hashed, the reminder **re-issues**
  a token that keeps the **original `expiresAt`** (no expiry extension) and
  invalidates the old link. One reminder per invite; failed sends retry on the
  next sweep.
- **Roles** are `enum UserRole { CUSTOMER DEV ADMIN }` (`USER` renamed).
  `requireAuth` + `requireAdmin` enforce server-side; `requireDev` lands with
  the releases module.
- **MFA**: DEV/ADMIN login returns `{ mfaRequired: true }` + an emailed
  6-digit OTP (`OtpPurpose.MFA_LOGIN`, 10-min TTL, 5 attempts); `verify-otp`
  exchanges it for tokens. MFA on every staff login; customers never see it.
  `SIGNUP_VERIFY` OTP retired entirely.
- **Captcha**: `svg-captcha` 6-char distorted text (ambiguous glyphs removed),
  served as a data-URI image; expected code stored sha256-hashed inside an
  httpOnly HMAC-signed cookie (10-min TTL). Required on signup.
- **Tokens**: 15-minute access JWT, 14-day rotating refresh token (hashed,
  reuse-revocation). Refresh cookie httpOnly + `sameSite=strict` scoped to
  `/api/auth/refresh`; access cookie readable by the SPA.
- **Email**: console sender by default, OCI Email Delivery when
  `EMAIL_PROVIDER=oci`. Templates: set-password, set-password reminder,
  pending-approval, MFA login, password reset (de-branded, no external assets).

## Assumptions

- Signup enumerates existing emails via `409 EMAIL_TAKEN` (accepted for MVP).
- Country is stored as ISO alpha-2; the dropdown list is a frontend concern.
- Competitor/free-mail lists are DB rows but admin CRUD endpoints are follow-up
  work (seed script only for now).
- Rejected (BLOCKED) users get no notification email (follow-up).

## Risks / follow-ups

- Rate limiting on signup/login/forgot-password/captcha — before production.
- Admin CRUD for `EmailDomainPolicy`; rejection email.
- "Remember device" MFA — explicitly out for MVP.
- DB schema is in `prisma/schema.prisma`; **no migration has been run**
  (`prisma generate` only). Integration suites for these flows are written but
  gated until the schema is applied (`db push` / `migrate` — needs explicit
  go).
- Older flows documented in `docs/auth/password-reset.md` still apply
  (OTP reset for all roles).
