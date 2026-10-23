# Review fixes: major bugs from the auth + releases review, and the roadmap

Status: planned, not started (2026-10-23). Source: a read-only review of server/ and client/ after OTP signup and release management landed.

## Context
Two questions after auth and release management landed: is download the only feature left, and are there major bugs? The code was reviewed in three read-only passes (feature inventory, server, client); the high-severity server findings were checked against the source.

**Answer to "is download the only thing left?": no.** Downloads are the biggest gap, but the whole customer side still runs on mock data. Remaining features are listed in Part B. Part A fixes the bugs first, because some of them matter before any customer touches the app.

---

## Part A: bug fixes (this task)

### Server: high severity
1. **Staff sign-in doesn't need the password, and codes can be guessed in parallel** (`services/auth/auth.service.ts` `resendOtp`, `services/auth/otp.service.ts`).
   - **Resend without a password:** `POST /auth/resend-otp {purpose: MFA_LOGIN}` emails a fresh login code to any staff email with no password check. `verify-otp` then signs in with email + code alone.
     - **Fix:** MFA resend only works while a login challenge exists, meaning an unconsumed, unexpired `MFA_LOGIN` code created by a successful password check. Otherwise it gives the same neutral 200 and sends nothing.
     - The new code **carries over the old code's attempt count**, so resending can't reset the 5-guess limit. A new allowance requires the password again.
   - **Parallel guessing:** `checkOtp` reads `attempts`, runs bcrypt (~250 ms), and only then increments. Parallel guesses all see 0.
     - **Fix:** reserve the attempt atomically before comparing: `updateMany({ where: { id, attempts: { lt: MAX } }, data: { attempts: { increment: 1 } } })`. A count of 0 means `OTP_ATTEMPTS_EXCEEDED`. On a correct code, undo the reservation (decrement), so an honest user doesn't lose an attempt.
   - **Codes used twice:** `verifyOtp` consumes the code without checking it wasn't already used, so two parallel correct submissions both succeed.
     - **Fix:** `updateMany({ where: { id, consumedAt: null } })`. A count of 0 means `OTP_INVALID`.
   - **Rate limiting:** add `express-rate-limit` (new dependency) on `captcha`, `signup*`, `login`, `verify-otp`, `resend-otp`, `forgot-password` and `reset-password`.
     - It's per IP plus email, kept in memory (one VM), with `app.set("trust proxy", …)` behind the proxy.
     - Over the limit returns `429 RATE_LIMITED` in the `ApiError` envelope.
2. **A cancelled upload can crash the API process** (`services/releases/release-files.service.ts` ~109–117, 169–171, 239, 262–265).
   - The cause: busboy's file stream is destroyed with an error while nothing listens to it.
   - **Fix:** attach `file.on("error", noop)` as soon as the file part arrives, and resume it after a discard.
   - **Test:** an integration test that aborts an upload mid-stream to a release that will be rejected (403/409), and asserts the server still answers.
3. **Login and refresh tokens are written to the logs.** `pinoHttp` logs the request `cookie` header and the response `set-cookie` header.
   - **Fix:** redact `req.headers.cookie`, `req.headers.authorization` and `res.headers["set-cookie"]` in `configs/logger.ts` / `app.ts`.
   - **Also:** in production, require `EMAIL_PROVIDER=oci` at boot (`configs/env.ts`). Otherwise a misconfigured prod logs every OTP code.
4. **Prod storage fails without `OCI_BUCKET`.** `getStorageConfig()` requires it, but the deploy doc only sets the staging and release buckets.
   - **Fix:** `getStorageConfig()` no longer requires `bucket`. Callers already pass the bucket from `getStorageBuckets()`.
   - `getObjectUrl()` (the future download link) takes the release bucket and refuses keys outside `releases/`.

### Server: medium severity
5. **Publish can go out with a stale version or unreviewed notes** (`services/releases/publish.service.ts` final step).
   - **Fix:** re-read the release in the final transaction. If `version`, `releaseNotes` or `updatedAt` changed since the snapshot, fail with `409 RELEASE_CHANGED`, clean up the copies, and keep the release in review.
6. **Signup step 1 can overwrite someone else's account details** (`signup.service.ts` resume path).
   - **Fix:** use a guarded `updateMany` (`status PENDING_SET_PASSWORD, password null`). A count of 0 means `EMAIL_TAKEN`.
7. **Reject isn't guarded against a concurrent approve** (`admin-signups.service.ts`).
   - **Fix:** a guarded `updateMany` from `PENDING_APPROVAL`, as approve already does.
8. **The captcha can be reused, and its answer can be cracked offline.**
   - **Fix:** the cookie carries a random nonce plus an HMAC of answer + nonce (with the server secret), not a hash of the answer anyone can compute.
   - Used nonces go in an in-memory set with a 10-minute TTL (single VM), so each captcha works for one signup only.
9. **Account enumeration in MFA** (`verify-otp`, `resend-otp` return `USER_NOT_FOUND` / `MFA_NOT_ALLOWED`).
   - **Done for password reset (2026-10-23):** reset now works by emailed link, and `forgot-password` always answers the same 200 (see `docs/auth/password-reset.md`).
   - **Still to fix:** `resend-otp` answers a neutral 200; `verify-otp` answers `OTP_INVALID` for unknown or ineligible accounts.
   - The client sign-in page already treats these as generic messages; check that copy still reads right.

Left as notes in the docs, not fixed now:
- **CORS for the prod hostname:** needs the real domain.
- **Domain matching:** policy matches exact domains only, so subdomains of a competitor get through.
- **Refresh ignores account status.**
- **Publish cleanup with several servers:** if more than one API process ever runs, cleanup after a failed publish could delete another job's files.

### Client: major
10. **Uploads keep going after leaving the editor** (`pages/ReleaseEditor/upload-queue.ts` `dispose`/`pump`).
    - **Fix:** a `disposed` flag stops `pump` and `start`, and queued items are dropped.
11. **One failed refresh unmounts the editor and aborts uploads** (`useReleaseQueries.ts` `useResource`, `EditRelease.tsx`).
    - **Fix:** a reload error keeps the last data and shows a toast instead of the error screen. The error screen stays for the first load.
12. **Sign-out races with refresh** (`components/common/UserMenu.tsx`, `auth/AuthProvider.tsx` `signOut`, `auth/session.ts`).
    - **The race:** it can revoke every device, or sign other tabs back in.
    - **Fix:**
      - `signOut` bumps `generation` so a late refresh is ignored;
      - it waits for any in-flight refresh, then logs out under `withDeviceLock`;
      - `UserMenu` awaits `signOut` before navigating.
13. **Toasts lost when the page changes.** Each `AppShell` mounts its own `<Toaster>`.
    - **Fix:** one `<Toaster>` in `App.tsx` above the routes, with the theme from the existing hook, removed from `AppShell`.

### Client: quick minor fixes in the same pass
- **`usePublishJob.ts` polling:** stop polling after repeated errors, and treat a lost job as published only when `status === "published"`.
- **Approve-dialog copy in `SignupsPage.tsx` (2 places):** it still says "a link to set their password". It becomes "We'll email them that they can sign in now."
- **`OtpCodeForm`:** the resend cooldown starts at 0 when it opens with an `initialError` (an expired or used-up code).
- **Search boxes** (`ReleaseTable.tsx`, `SignupsPage.tsx`): sync the local search from the URL, so a stale debounce doesn't write an old `q` back.

## Verification
- **Server:**
  - New or updated integration tests: MFA resend without a login challenge (sends nothing); parallel wrong guesses (at most 5 counted); double-consume; the 429 limit; resume can't overwrite a finished account; reject vs approve; publish fails with `RELEASE_CHANGED` after a mid-copy edit; the aborted upload keeps the server alive; captcha reuse refused.
  - Unit tests: logger redaction config; storage config without `OCI_BUCKET`.
  - Then `npm run test` (after your `SIGNUP_VERIFY` migration), lint and tsc.
- **Client:** tsc, lint, vitest, build.
- **Manual:**
  - Upload several files and leave the editor (uploads stop).
  - Sign out with two tabs open.
  - Delete a release (the toast shows on the list).
  - Staff login: resend works, and resend before entering the password sends nothing.
- Update `docs/auth/auth-module.md` (MFA resend rule, rate limits, captcha) and `docs/releases/release-management.md` (`RELEASE_CHANGED`, the upload crash fix).

---

## Part B: what's left in the product (roadmap, not this task)
1. **Customer catalog + downloads** (the core feature):
   - **Server:** catalog API (products → published release → files with SHA-256, plus resources); `POST /downloads/:fileId` (checks access, writes a `Download` row, returns a ~60 s read-only object PAR on the release bucket).
   - **Schema:** uncomment `Download` in the schema (migration).
   - **Client:** `catalog.data.ts` mock replaced by the real API; checksum shown next to the download; "recent downloads" from the log; staff download on the release page.
2. **Rollback emails** to everyone who downloaded the bad build (needs 1), plus the HubSpot download properties.
3. **Forgot / reset password pages:** the server endpoints already exist.
4. **Admin CRUD:** products and resources (`ProductResource` has no service yet), email domain lists.
5. **Notifications:** submitted, changes requested and published emails to staff.
6. **Ops before production:**
   - the cross-bucket `storage:copy-smoke`;
   - the prod CORS allowlist;
   - a manual end-to-end pass;
   - email client QA;
   - removing the `TODO(auth-otp-signup)` code and the `SetPasswordToken` table;
   - archiving the stale `tasks/` files into `docs/` (`release-management`, `auth`, `auth-integration`, …).
