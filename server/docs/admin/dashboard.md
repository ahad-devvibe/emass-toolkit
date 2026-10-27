# Admin dashboard

## What was built

An admin-only Dashboard (`/admin/dashboard`, the admins' home page and the first
sidebar entry). It shows:
- **Five stats:** active users (customers and staff), pending sign-ups,
  competitors blocked, sign-ups rejected, and releases in review.
- **Queues:** the oldest 5 releases waiting for review and the oldest 5
  sign-ups waiting for approval, each with its total. The two cards are always
  the same height.

API: `GET /api/admin/dashboard` (`requireAdmin`). Sign-ins, refusals and
completed password resets are recorded in `AuthEvent` but not shown on the
dashboard.

## Key decisions

- **Polling, not push:** the page refetches every 30 s while the tab is
  visible, and again when it becomes visible. That's enough on one VM. SSE can
  replace it later without changing the endpoint. Background refreshes are
  silent: no wording, no spinner. Only a manual Refresh spins.
- **Sign-ins stay off the dashboard:** `AuthEvent` grows without bound, so the
  dashboard never reads it. It's kept for audits and a future activity-log
  page.
- **Alerts are queues, not notifications:** they are derived from current
  state (IN_REVIEW releases, PENDING_APPROVAL users), so they clear once
  handled. There's no read/unread storage.
- **Sign-ups:** the dashboard only shows who is waiting. Approve and reject
  stay on the Signups page ("Review all").
- **Release queue order:** oldest submission first. Nothing edits a release in
  review, so `updatedAt` stands in for the submit time. The time shown is the
  latest SUBMITTED event.
- **Blocked split:** stored as `User.blockReason`:
  - `COMPETITOR_DOMAIN` is set by signup;
  - `SIGNUP_REJECTED` is set by an admin reject;
  - the migration backfilled existing rows (no password means competitor).

  Blocked rows without a reason aren't counted. The reason, like
  `rejectionReason`, never leaves the server in user responses.
- **Sign-in audit (`AuthEvent`):**
  - It records customer logins and staff MFA verifies as
    `SIGN_IN_SUCCEEDED`, 4xx refusals as `SIGN_IN_FAILED` with the error code
    (unknown emails included, with no user), and `PASSWORD_RESET`.
  - The staff password step isn't a sign-in yet, so it records nothing.
  - Writes are best effort and outside transactions: a failed audit write is
    logged and never fails the request.
- **Downloads:** no card yet. It comes with the downloads task (`Download`
  model).

## Assumptions

- Behind nginx, `TRUST_PROXY=1` must be set, or every recorded IP is the
  proxy's. It defaults to 0 (trust none).
- "Active users" means status ACTIVE. It's not "signed in recently".

## Risks / follow-ups

- `AuthEvent` grows without bound. It needs a retention job (for example 90
  days) before launch.
- No activity-log page yet, so nobody sees failed sign-ins. Rate limiting is
  tracked in `tasks/review-fixes.md`.
- Polling costs four small queries per open dashboard every 30 s.
  `User.status` has no index, which is fine at current sizes.
