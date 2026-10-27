# Auth module

## What was built

The auth stack for the EMASS-Toolkit API, under `/api/auth` plus
`/api/auth/admin`. It covers:

- signup on one page: form, then an emailed 6-digit code, then a password;
- domain policy, with free-mail signups going to an admin approval queue;
- a distorted-text captcha;
- login: a password for customers, plus email-OTP MFA for DEV and ADMIN;
- rotating, DB-backed refresh tokens;
- password reset by emailed link (`docs/auth/password-reset.md`).

The original spec is `tasks/auth.md`.

## Key decisions

- **Signup proves the inbox before an account counts** (2026-10-23; replaced
  the set-password-link flow). It runs in three steps on `/sign-up`:
  1. **`POST /auth/signup`**
     - Takes the profile (work email, firstName, middleName?, lastName,
       country as ISO alpha-2, companyName, jobTitle, useCase) plus the
       captcha, with no password.
     - `useCase` is required free text (10–1000 characters, trimmed): what
       the person will use EMASS for. It's stored on `User.useCase` (null for
       older accounts) and shown to admins on the Signups page.
     - Emails a code (`OtpPurpose.SIGNUP_VERIFY`, 10-minute TTL, 5 attempts)
       and answers `201 { email }`.
  2. **`POST /auth/signup/verify {email, code}`** checks the code without
     using it up.
  3. **`POST /auth/signup/complete {email, code, password}`** uses up the code
     and sets the password (6–72 characters, bcrypt) and `emailVerified`, in
     one transaction. The domain is classified again here, so a policy change
     made mid-signup still applies.
  - **Until step 3 the row is an "unfinished signup":** `PENDING_SET_PASSWORD`
    with no password. It can't sign in (no password means
    `INVALID_CREDENTIALS`).
    - Signing up again with the same email **resumes** it: the details are
      refreshed and a new code sent.
    - An email with an `ACTIVE`, `PENDING_APPROVAL` or `BLOCKED` account gets
      `409 EMAIL_TAKEN`.
    - If the first code email fails, a brand-new row is deleted again.
  - **Verify, complete and resend don't reveal accounts:** an unknown email or
    a finished account gets the same `OTP_INVALID` as a wrong code. Resend
    (`POST /auth/resend-otp`, purpose `SIGNUP_VERIFY`) answers 200 and sends
    only for an unfinished signup.
  - **No new user status and no background jobs.**
- **Domain policy** (`EmailDomainPolicy` table, seeded with
  `npm run seed:domains`):
  - **Managed by admins in the UI** (`/admin/domains`; `GET/POST
    /api/admin/domains`, `DELETE /api/admin/domains/:id`). Input is normalised
    (`@Gmail.com` or a pasted address becomes `gmail.com`). A domain is on one
    list at most (`409 DOMAIN_EXISTS` names the list that has it).
  - Changes apply to **new sign-ups only**: existing accounts keep their
    status.
  - The seed adds missing file domains and never deletes database-only rows,
    so UI additions survive it. A domain removed in the UI but still in
    `data/domain-policy.json` comes back on the next seed.
  - **COMPETITOR** (seed: `blocked-competitor.example`): `403 DOMAIN_BLOCKED`
    at step 1, before any code is sent.
    - A `BLOCKED` user row with no password is kept as an audit trail.
    - Repeat attempts with the same email get the same 403 and add no rows.
  - **FREE_MAIL** (seed: gmail, yahoo, outlook, hotmail, icloud, aol):
    - Step 3 ends in `PENDING_APPROVAL`, with the "request received" email,
      and answers `{ user, signedIn: false }`.
    - An admin approves (`POST /auth/admin/signups/:id/approve`): the
      account becomes `ACTIVE`, the person gets the "you can sign in" email
      and a HubSpot contact is created.
    - Approval is guarded, so two admins approving at once activate and
      email only once.
    - Reject is unchanged: `BLOCKED`, plus an email with the optional reason.
  - **Anything else** (company domains): step 3 ends `ACTIVE`, **signed in
    directly** (cookies set, `{ user, signedIn: true }`), with the welcome
    email and a HubSpot contact.
- **The set-password-link flow is hidden, not deleted.** Its code is kept and
  marked `// TODO(auth-otp-signup): unused since OTP signup, remove later`:
  - `set-password.service.ts` and its three controllers (the routes are
    unmounted, so `/auth/set-password*` and `/auth/resend-set-password` now
    404);
  - the reminder job in `scheduler.service.ts`, off through
    `SET_PASSWORD_REMINDERS_ENABLED = false`;
  - the set-password and reminder email templates;
  - the `SET_PASSWORD_*` env vars;
  - the `setPasswordSchema` / `resendSetPasswordSchema` schemas;
  - `hubspot.utils.ts` (the portal-status property);
  - the `SetPasswordToken` table, which stays in the schema so no destructive
    migration is needed.

  The client's `/set-password` page is removed.
- **Roles** are `enum UserRole { CUSTOMER DEV ADMIN }`, enforced on the server
  (`requireAuth`, `requireRole`).
- **MFA**:
  - DEV/ADMIN login returns `{ mfaRequired: true }` and emails a 6-digit OTP
    (`OtpPurpose.MFA_LOGIN`, 10-minute TTL, 5 attempts).
  - `verify-otp` exchanges the code for tokens. It accepts only `MFA_LOGIN`:
    signup codes have their own endpoints, and password reset uses a link.
  - MFA applies to every staff login; customers never see it.
- **Captcha**:
  - `svg-captcha` with 6 distorted characters (ambiguous glyphs removed),
    served as a data-URI image.
  - The expected code is stored sha256-hashed inside an httpOnly,
    HMAC-signed cookie (10-minute TTL).
  - Required on signup step 1, and single-use: the cookie is cleared on
    success.
- **Tokens** travel **only in httpOnly cookies**. No response body ever
  carries a token, and JS never reads one.
  - **Access token:**
    - a 15-minute JWT in the `accessToken` cookie, `sameSite=strict`, path
      `/api`, with max-age equal to the JWT lifetime;
    - `requireAuth` reads only this cookie; an `Authorization: Bearer` header
      is ignored, giving `401 TOKEN_MISSING`.
  - **Refresh token:**
    - a 14-day rotating token (stored hashed) in the `refreshToken` cookie,
      `sameSite=strict`, path `/api/auth`, so both `/refresh` and `/logout`
      receive it; a token sent in the body is ignored;
    - login, MFA verify, signup completion (company address) and refresh set
      both cookies; logout revokes the refresh token and clears both.
  - **CSRF** is covered by `sameSite=strict` plus the CORS origin check
    (`app.ts`), which rejects disallowed origins with
    `403 CORS_ORIGIN_DENIED` before any route runs. The SPA and API share one
    origin.
  - **Client** (`client/src/auth/session.ts`): on
    `401 TOKEN_MISSING/EXPIRED/INVALID` it runs one `/refresh` (single-flight,
    with a device-wide lock) and retries once.
- **Reuse detection**:
  - Rotating a token revokes it. Presenting a revoked token returns
    `401 REFRESH_TOKEN_REUSED` and revokes every token the user has, on all
    devices.
  - Two concurrent refreshes with the same cookie trip this, so clients must
    keep one `/refresh` in flight per device.
  - `issueTokenPair` prunes the user's expired tokens and the tokens revoked
    more than `REUSE_DETECTION_WINDOW_MS` (24 h) ago. Younger revoked rows
    stay, so replays are still detected.
- **CORS** allows localhost and private-network origins with credentials.
  Anything else gets `403 CORS_ORIGIN_DENIED` in the standard error envelope.
- **Staff accounts**: `npm run seed:users` upserts the users listed in the
  gitignored `data/staff-users.json` (template:
  `data/staff-users.example.json`) as ACTIVE, with bcrypt-hashed passwords.
  - It is idempotent and never deletes.
  - Existing passwords are kept unless you pass `--reset-passwords`.
  - `--dry-run` prints the plan.
- **HubSpot** is a one-way, email-keyed upsert. It is only logged unless
  `HUBSPOT_ENABLED=true`. Setup steps (private app, scopes, fields, contact
  layout): `docs/operations/hubspot-setup.md`.
  - **A contact is created only once an account is `ACTIVE`,** sent as
    `lifecyclestage: "lead"` with the name, country, company and job title,
    and the use case in the custom free-text property `emass_use_case`.
    `npm run hubspot:setup` creates that property (once per HubSpot portal,
    before enabling HubSpot; safe to re-run after upgrades).
  - **Download tracking (customers only):**
    - **Counters on `User`:** each customer download updates `downloadCount`,
      `firstDownloadAt`/`Label` and `lastDownloadAt`/`Label`, in the same
      transaction as the `Download` row. That's O(1) per click. A guarded
      `updateMany` claims "first", so concurrent clicks have one first.
    - **HubSpot sync:** `syncDownloadsToHubspot` reads that one row and
      **sets** `emass_download_count`, `emass_first_download_at`,
      `emass_last_download_at`, `emass_first_download` and
      `emass_last_download`. It never increments in HubSpot, which has no
      atomic increment, so a retry would miscount.
    - **Progress:** `hubspotSyncedDownloads` records what HubSpot has.
    - **First download:** a note goes on the contact ("First download from the
      EMASS portal: … Accepted the EMASS Software Licence (version) on date").
      It's sent once: claimed through `hubspotNoteSentAt`, released if creating
      it fails, so it's retried.
    - **Never blocking:** the sync runs fire-and-forget after the link is
      returned; failures are only logged.
    - **Recovery, no scheduler (v1 decision):** a failed sync is repaired by
      the customer's next download, which resends the current stored totals
      and retries the note.
      - `npm run hubspot:resync` runs `syncPendingDownloads` on demand: every
        customer where `downloadCount > hubspotSyncedDownloads` or the note is
        missing, in random order so a few failing contacts can't starve the
        rest. Use it after setup, an outage or a token change.
      - **Accepted gap:** a customer whose last sync failed and who never
        downloads again stays stale until someone runs the resync.
      - **If that becomes a complaint,** a "Sync now" button in admin Settings
        can call the same function. A background job was deliberately left
        out.
    - **Missed activation sync:** a contact with no `hubspotContactId` is
      upserted first.
    - **Token scopes:** the private app needs the notes write scope as well as
      contacts write. Full setup: `docs/operations/hubspot-setup.md`.
  - **Admins can check the connection** in Settings (sidebar gear or the
    account menu). `GET /api/admin/integrations/hubspot` reads every property
    the portal writes in one batch read, read-only, with a 5 s timeout. That
    proves the token, its scopes and the setup in one call (a missing property
    reads as "isn't fully set up"). It answers `connected`,
    `off` or `problem` with a plain sentence. Details (HTTP status, network
    error) are logged, never shown. The token stays in `.env`.
  - **`emass_portal_status` is removed** (code and setup script). Customer
    accounts only ever reach HubSpot as active, so it had nothing to say. A
    HubSpot account set up earlier may still have the empty "EMASS Portal
    Status" field; delete it by hand.

  | Event | DB status | HubSpot |
  |---|---|---|
  | Step 1 (form + code), any domain | `PENDING_SET_PASSWORD` (unfinished) | nothing |
  | Competitor domain | `BLOCKED` (audit row) | nothing |
  | Step 3, company domain | `ACTIVE` | contact upserted (`lead`) |
  | Step 3, free mail | `PENDING_APPROVAL` | nothing |
  | Admin approves a free-mail request | `ACTIVE` | contact upserted (`lead`) |
  | Admin rejects a free-mail request | `BLOCKED` | nothing |

  - **The private-app token** needs `crm.objects.contacts.write`.
    `npm run hubspot:setup`, which creates the old status property, is no
    longer needed.
- **HubSpot contact reference**: each successful upsert stores HubSpot's
  record ID on the user (`User.hubspotContactId`, unique, plus
  `hubspotSyncedAt`).
  - It stays `null` until the first successful sync.
  - It is internal only: `presentUser` strips it.
  - If HubSpot returns an ID already linked to another user, nothing is
    overwritten and a warning is logged.
  - Syncs (`syncHubspotContact`, called from `onAccountActivated` in
    `signup.service.ts`) are best-effort: a failure is logged and never fails
    signup or approval.
- **Email** uses a console sender by default, and OCI Email Delivery when
  `EMAIL_PROVIDER=oci`. Templates in use:
  - signup code ("Confirm your email");
  - request received (pending approval);
  - welcome / approved;
  - signup rejected;
  - MFA login;
  - password reset (a 30-minute, single-use link).

  None of them load external assets.

## Assumptions

- **Signup enumerates existing emails** through `409 EMAIL_TAKEN` (accepted
  for the MVP). The verify, complete and resend steps don't.
- **Country** is stored as an uppercase ISO 3166-1 alpha-2 code, validated
  against the assigned list in `src/utils/country.utils.ts`. Signup and
  `seed:users` use that list, and so does the client picker. HubSpot receives
  the English name ("SG" becomes "Singapore").
- **The competitor and free-mail lists** are DB rows, but their admin CRUD
  endpoints are follow-up work; only the seed script exists for now.
- **Rejecting a signup** (BLOCKED) emails the person.
  - The admin can add an optional reason (up to 500 characters). It goes into
    the email and is stored on `User.rejectionReason` for audit (null when
    none was given; never returned by the API).
  - Approvals carry no note.
  - The email is best-effort: a failed send is logged and the rejection
    stands.
- **No accounts from the old flow are expected to remain** (pre-launch).
  - A `PENDING_APPROVAL` row created before this change has no password.
    Approving it would make it `ACTIVE` with no way to sign in
    (`forgot-password` refuses passwordless accounts).
  - Reject such rows, and the person signs up again.

## Risks / follow-ups

- **Rate limiting** on signup, signup/verify, login, forgot-password and the
  captcha, before production.
  - Competitor attempts and unfinished signups both write `User` rows, and the
    captcha is their only guard.
  - Wrong codes are capped at 5 per code, but resend can issue new ones.
- **Unfinished signups are never cleaned up.** They are harmless (no password,
  no HubSpot contact) and are resumed by signing up again; a cleanup job can
  come later.
- **HubSpot reconcile job:** a contact missed during an outage is not retried.
- **Admin CRUD** for `EmailDomainPolicy`.
- **"Remember device"** for MFA is explicitly out of scope for the MVP.
- **Removing the hidden set-password code:** delete everything marked
  `TODO(auth-otp-signup)`, then drop `SetPasswordToken` in a migration.
- **Password reset** works by emailed link for every role, as described in
  `docs/auth/password-reset.md`.
