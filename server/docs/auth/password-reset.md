# Password reset

## What was built

Forgot password by emailed link (2026-10-23; this replaced the earlier reset by 6-digit code).

| Step | Endpoint | Client |
|---|---|---|
| 1. Ask for a link | `POST /auth/forgot-password {email}` | `/forgot-password` (the "Forgot password?" link on sign-in) |
| 2. Open the link | `POST /auth/reset-password/check {token}` → `{ email }` | `/reset-password?token=…` |
| 3. Set the password | `POST /auth/reset-password {token, newPassword}` | same page, then back to sign-in |

- **Service:** `src/services/auth/password-reset.service.ts`.
- **Table:** `PasswordResetToken`.
- **Email template:** `email/templates/password-reset.template.ts`.
- **Tests:** `tests/integration/password-reset.test.ts`.

## Key decisions

- **The answer never reveals an account.** `forgot-password` always returns 200, "If an account exists for that email, we've sent a reset link." This holds:
  - for an unknown email;
  - for a blocked account;
  - for an unfinished signup (no password yet);
  - even when the email fails to send (the failure is logged, not returned).

  Only a configuration error (`assertReady`) surfaces.
- **Who gets a link:** accounts that have a password and aren't `BLOCKED`, which means `ACTIVE` and `PENDING_APPROVAL`.
- **The link:**
  - **What it carries:** 32 random bytes (base64url). Only its sha256 is stored (`tokenHash`, unique).
  - **Lifetime:** 30 minutes (`RESET_LINK_TTL_MS`).
  - **Works once.**
- **Only the newest link works.** A new request deletes the account's earlier tokens.
- **Anti-spam:** if a link was issued less than 60 s ago (`RESET_REQUEST_COOLDOWN_MS`), a new request quietly sends nothing. The client's "Send again" waits 60 s too.
- **Checking a link doesn't use it up.** `check` lets the page show "Choose a new password for {email}" or the error before anything is typed.
- **Errors:**
  - an unknown token, a used token, or an account no longer eligible → `RESET_LINK_INVALID`;
  - a token past its expiry → `RESET_LINK_EXPIRED`.

  Both are 400. Telling them apart reveals nothing, because only the inbox owner holds the token.
- **The reset itself:**
  - **Reusing the current password:** gets `400 PASSWORD_REUSE` and does **not** use the link up.
  - **Otherwise:** one transaction marks the token used with a guarded `updateMany` (unused and unexpired), so a double submit lets only one through. The same transaction sets the password and deletes the account's other tokens.
  - **After commit:** `revokeAllUserTokens` signs the account out on every device.
- **The token stays out of URLs and logs on the server side.** `check` and `reset` are POSTs with the token in the body. The client reads `?token` once and then removes it from the address bar, so it doesn't stay in history or leak in `Referer` headers.
- **`/reset-password` isn't guest-only,** so the link works in a browser that's still signed in. That tab is signed out after the reset.
- **The code-based reset is gone:**
  - `verify-otp` accepts only `MFA_LOGIN`;
  - `resend-otp` accepts `MFA_LOGIN` or `SIGNUP_VERIFY`;
  - the `OtpPurpose.PASSWORD_RESET` enum value is left in the schema, unused, to avoid a destructive migration.

## Assumptions

- **30 minutes is enough** to open the email and choose a password. An expired link leads to "Request a new link".
- **Timing:** an existing account takes slightly longer to answer, because it writes a row and sends an email. That timing difference is accepted for the MVP.

## Risks / follow-ups

- **Migration:** the `PasswordResetToken` table needs `prisma migrate dev --name add_password_reset_token` and `npm run test:migrate` before the integration suite can run.
- **Rate limiting:** there's no per-IP rate limit on `forgot-password` yet. The 60 s per-account cooldown only stops repeated emails to one inbox (see `tasks/review-fixes.md`).
- **No "your password was changed" email** after a successful reset.
- **Old tokens aren't cleaned up:** used or expired rows stay until the account's next request or reset.
