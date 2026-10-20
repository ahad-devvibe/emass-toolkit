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
  - COMPETITOR (seed: `blocked-competitor.example`) → `403 DOMAIN_BLOCKED`.
    A `BLOCKED` user row (no password) is kept as an audit trail; repeat
    attempts with the same email get the same 403 and don't add rows.
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
- **Tokens**: 15-minute access JWT, returned in the response body only and sent
  back as `Authorization: Bearer` (the SPA keeps it in memory; there is no
  access cookie). 14-day rotating refresh token (hashed), **cookie only**:
  httpOnly + `sameSite=strict`, path `/api/auth` so both `/refresh` and
  `/logout` receive it; it is never in a response body and a body token is
  ignored. Logout revokes it.
- **Reuse detection**: rotating a token revokes it. Presenting a revoked token
  returns `401 REFRESH_TOKEN_REUSED` and revokes every token the user has (all
  devices). Two concurrent refreshes with the same cookie trip this, so clients
  must keep one `/refresh` in flight per device. `issueTokenPair` prunes the
  user's expired tokens and tokens revoked more than
  `REUSE_DETECTION_WINDOW_MS` (24h) ago; younger revoked rows stay so replays
  are still detected.
- **CORS**: localhost and private-network origins with credentials; anything
  else gets `403 CORS_ORIGIN_DENIED` in the standard error envelope.
- **Staff accounts**: `npm run seed:users` upserts the users in the gitignored
  `data/staff-users.json` (template: `data/staff-users.example.json`) as
  ACTIVE with bcrypt-hashed passwords. Idempotent; never deletes; existing
  passwords are kept unless `--reset-passwords`; `--dry-run` prints the plan.
- **HubSpot** (one-way, email-keyed upsert; logged only unless
  `HUBSPOT_ENABLED=true`). Every legitimate account gets a contact before it
  has a password; blocked and rejected sign-ups never reach HubSpot (their DB
  row is the audit trail):

  | Event | DB status | HubSpot `emass_portal_status` | `lifecyclestage` |
  |---|---|---|---|
  | Sign-up, company domain | `PENDING_SET_PASSWORD` | `pending_password` | `lead` |
  | Sign-up, free mail | `PENDING_APPROVAL` | none | none |
  | Sign-up, competitor domain | `BLOCKED` (audit row) | none | none |
  | Admin approves a free-mail request | `PENDING_SET_PASSWORD` | `pending_password` | `lead` |
  | Admin rejects a free-mail request | `BLOCKED` | none | none |
  | Password set | `ACTIVE` | `active` | `customer` |

  `emass_portal_status` is a custom **enumeration** contact property (options
  `pending_password`, `active`) that must exist before enabling the
  integration, or HubSpot rejects every upsert. Create it from code once per
  HubSpot portal with `npm run hubspot:setup` (`-- --dry-run` to preview). It's
  idempotent: it creates the property, or brings an existing one in line with
  the definition (label "EMASS Portal Status", description, missing options)
  in one PATCH, and never removes options or changes the type. Re-run it after
  changing the definition. The private-app token needs `crm.schemas.contacts.write` for
  that run and `crm.objects.contacts.write` for normal syncing. Manual
  alternative: HubSpot Settings → Properties → Contact → Create property, with
  internal name `emass_portal_status`, field type Dropdown select and the two
  options above. The definition lives in `src/services/hubspot/hubspot.utils.ts`.
- **HubSpot contact reference**: each successful upsert stores HubSpot's record
  ID on the user (`User.hubspotContactId`, unique, plus `hubspotSyncedAt`).
  It's `null` until the first successful sync, is internal only (`presentUser`
  strips it) and is what future events and reconcile jobs target. If HubSpot
  returns an ID already linked to another user, nothing is overwritten and a
  warning is logged for a human to resolve. All syncs go through `syncHubspotContact`
  and are best-effort: a failure is logged and never fails sign-up, approval
  or activation; the next transition re-upserts the contact.
- **Email**: console sender by default, OCI Email Delivery when
  `EMAIL_PROVIDER=oci`. Templates: set-password, set-password reminder,
  pending-approval, MFA login, password reset (de-branded, no external assets).

## Assumptions

- Signup enumerates existing emails via `409 EMAIL_TAKEN` (accepted for MVP).
- Country is stored as an uppercase ISO 3166-1 alpha-2 code, validated against
  the assigned list in `src/utils/country.utils.ts` (signup and `seed:users`;
  the client picker uses the same list). HubSpot receives the English name
  ("SG" -> "Singapore").
- Competitor/free-mail lists are DB rows but admin CRUD endpoints are follow-up
  work (seed script only for now).
- Rejecting a sign-up (BLOCKED) emails the person; the admin can add an
  optional reason (≤500 chars) that is included in the email but not stored.
  The email is best-effort: a send failure is logged and the reject stands.

## Risks / follow-ups

- Rate limiting on signup/login/forgot-password/captcha — before production.
  Competitor-domain attempts now write a `BLOCKED` row, so without rate
  limiting (captcha is the only guard) they can grow the `User` table.
- HubSpot reconcile job: a contact missed during an outage is only repaired at
  the next transition (approval or activation); an `ACTIVE` user missed at
  activation stays `pending_password` in HubSpot until reconciled.
- Admin CRUD for `EmailDomainPolicy`; rejection email.
- "Remember device" MFA — explicitly out for MVP.
- DB schema is in `prisma/schema.prisma`; **no migration has been run**
  (`prisma generate` only). Integration suites for these flows are written but
  gated until the schema is applied (`db push` / `migrate` — needs explicit
  go).
- Older flows documented in `docs/auth/password-reset.md` still apply
  (OTP reset for all roles).
