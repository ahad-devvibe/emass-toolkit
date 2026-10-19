# Password reset

## What was built

Two-step, OTP-based password reset: `POST /auth/forgot-password` emails a
6-digit code (10-min TTL, 5 attempts), `POST /auth/reset-password` consumes
email + code + new password in one request. `POST /auth/verify-otp` with
`purpose: PASSWORD_RESET` lets a UI validate the code first without consuming
it. Implemented in `src/services/auth/auth.service.ts` (+ `otp.service.ts`),
schemas in `src/schemas/auth.schema.ts`, integration suite in
`tests/integration/password-reset.test.ts`.

## Key decisions

- **Validate ≠ authorize**: `verify-otp` for `PASSWORD_RESET` only checks the
  code; the code must be sent again with `reset-password` and is consumed there.
  A code consumed at validation would break the two-screen UI flow.
- **Reset revokes everything**: on success the OTP row is deleted, all refresh
  tokens for the user are revoked, and the old password stops working — one
  request changes the password and ends every session.
- **`PASSWORD_REUSE` guard**: resetting to the current password is rejected
  (400) and does NOT consume the OTP, so the user can retry with the same code.
- **Passwordless accounts** (`password: null`, legacy OAuth-era rows) get
  `PASSWORD_NOT_SET` on both forgot and reset — the flow cannot bootstrap a
  password that was never set; they must re-sign-up.
- **Cross-user isolation**: the code is bound to the email/user it was issued
  to — another user's code fails with `OTP_INVALID` (covered by a dedicated
  test).

## Assumptions

- The user knows their registered email (no account-enumeration protection
  beyond a uniform shape — `USER_NOT_FOUND` 404 is returned; acceptable for
  an MVP behind login approval).
- 10-minute code lifetime is enough for email delivery + user typing time.

## Risks / follow-ups

- Gated with the auth module on **Gate G1** (migration not applied yet) — the
  integration suite is written but cannot pass until a migration lands.
- No rate limiting / resend cooldown on `forgot-password` — add before launch.
- Same single `JWT_SECRET` / console-email caveats as the auth module.
