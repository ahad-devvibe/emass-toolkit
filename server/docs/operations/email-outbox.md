---
title: Email outbox — rollback notices and release announcements
---

# Email outbox

Bulk mail (one email per customer) goes through a Postgres table and a small
worker inside the API process. Sign-in codes, password resets and other
one-person emails don't: they stay direct and instant.

| Event | Who gets it | Template | Priority |
|---|---|---|---|
| **Rollback** of a release | every ACTIVE customer who downloaded **that** release | "vX has been withdrawn" | first (0) |
| **Publish** of a release | every ACTIVE customer who downloaded **any other release of the product** | "vX is available" | after rollbacks (10) |

There's no opt-out from announcements yet.

## How it works
1. **Queued with the change.** The rollback or publish transaction runs one
   `INSERT … SELECT` that adds a row per recipient to `EmailOutbox`
   (`email-outbox.service.ts`). The rollback or publish and its emails happen
   together or not at all. `(batchId, toEmail)` is unique, so nobody is
   queued twice; the batch id is the `ROLLED_BACK` or `PUBLISHED` event's id.
2. **Sent by the worker** (`email-worker.ts`). It's an async loop in the API
   process, not a thread or a service. It spends its time awaiting OCI and
   the pace gap, so API requests aren't slowed. It runs when:
   - a rollback or publish is committed;
   - the server starts (resuming anything a restart left behind);
   - a timer for the next retry fires.

   With nothing due, nothing runs.
3. **Claiming:** up to 25 due rows at a time, under a 5-minute lease, with
   `FOR UPDATE SKIP LOCKED`. Two processes (e.g. during a deploy) get
   different rows; a worker that dies leaves its rows for another once the
   lease expires.
4. **Outcomes:**
   - **sent** → `SENT`;
   - **throttled (429), OCI 5xx or network error** → back to `PENDING`, retried
     after 1 min, 5 min, 30 min, then 2 h;
   - **any other 4xx (e.g. bad address), 5 attempts used, or the user was
     blocked or deleted since** → `FAILED` with `lastError`.
5. **Batch summary:** when a batch has nothing left to send, a
   `CUSTOMERS_NOTIFIED` event appears in the release's Activity, by the admin
   who rolled back or published:
   - "Emailed 998 customers who downloaded v1.4.0 (2 failed)."
   - "No customers had downloaded v1.4.0."
   - "Announced v1.5.0 to 998 customers (2 failed)."

   An announcement that reached nobody records nothing.

Delivery is at least once: a duplicate is possible only if the process dies,
or the database errors, right after OCI accepted a mail and before its row was
marked `SENT`. Such a row is never marked failed; it's sent again once its
lease runs out.

**Recovery and ownership:**
- **A failed drain** (e.g. the database dropped mid-drain) is retried after
  60 s, so the queue never stalls until the next restart.
- **Marks are conditional on the lease:** a worker only records a row's
  outcome while the row is still its own. If its lease ran out and another
  worker re-claimed the row, the late result is ignored.
- **Claims are sized to the lease:** each claim takes no more rows than can
  be sent in 80% of the 5-minute lease at the configured pace.

## Deploying
- **Postgres 13 or newer:** queueing uses `gen_random_uuid()`. Check with
  `SHOW server_version;`. On an older server, rollback and publish fail until
  `CREATE EXTENSION pgcrypto;` is run.
- **pm2 `kill_timeout`:** pm2 sends SIGINT on restart and kills the process
  after `kill_timeout` (default 1.6 s). The worker stops after its current
  send, but at 10/min it may be waiting up to 6 s for its next slot. If it's
  killed first, nothing is lost: its claimed rows are sent after the restart,
  once their lease (≤5 min) runs out, each using one attempt. Set
  `kill_timeout` to about 10000 on the VM for a clean stop.

## Settings (`server/.env`)
| Variable | Default | Meaning |
|---|---|---|
| `EMAIL_BULK_PER_MINUTE` | 10 | Bulk sends per minute, per API process (1–60000) |
| `EMAIL_BULK_DAILY_CAP` | 150 | Bulk sends in any 24 h; the rest wait until quota frees up |

Match them to the OCI tenancy (Console → Governance → Limits → Email
Delivery). The cap keeps bulk mail from using the quota sign-in codes need.

| Tenancy | OCI limit | Suggested |
|---|---|---|
| Free trial | 10/min, 200/day | 10 and 150 (the defaults) |
| Paid | about 50,000/day, thousands/min | e.g. 300 and 40,000 |

With more than one API process, each sends at the full pace; divide the
setting accordingly. Change the values, then `pm2 restart <app> --update-env`.

## Watching and fixing
- **Progress of a batch:**
  ```sql
  SELECT status, count(*) FROM "EmailOutbox" WHERE "batchId" = '<event id>' GROUP BY status;
  ```
- **Why something failed:** `SELECT "toEmail", attempts, "lastError" FROM "EmailOutbox" WHERE status = 'FAILED' ORDER BY "createdAt" DESC;`
- **Retrying failed rows by hand** (there's no admin button yet): set them
  back to `PENDING` with `attempts = 0` and `nextAttemptAt = now()`, then
  restart the API or trigger any rollback or publish to wake the worker.
- **Logs:** each failed send logs `bulk email failed` at `warn`; reaching the
  daily cap logs `bulk email daily cap reached; waiting`.

## Table
`EmailOutbox` (migration `20261029120000_email_outbox`): `kind`, `priority`,
`batchId`, `userId`, `toEmail`, `payload` (template input incl. firstName),
`status`, `attempts`, `nextAttemptAt`, `lockedUntil`, `lastError`, `sentAt`,
`createdAt`.
- **Claims read only a partial index of unsent rows** (`EmailOutbox_due_idx`),
  so they stay fast however many rows are `SENT`. Rows are kept as the record
  of who was emailed.
- **Timestamps** are compared as UTC wall-clock values in Node, never with
  Postgres `now()`, which follows the session time zone.

## Decisions and risks
- **Postgres as the queue:** no Redis, no separate service; one VM today.
- **Rollback rows go first**, announcements after; within a priority, oldest
  first.
- **Growth:** tens of thousands of rows a year are expected. If claim time or
  table size degrades, add a retention purge for old `SENT` rows; the
  `CUSTOMERS_NOTIFIED` note stays as the lasting record.
- **Follow-ups:**
  - opting out of announcements (an unsubscribe link and a per-user flag);
  - an admin "retry failed" action and a batch progress view;
  - a load benchmark (1,000 rollback + 1,000 announcement emails at once);
  - the retention purge above.

## OCI Email Delivery facts
- **Free trial:** 200 emails per rolling 24 h, at most 10 a minute.
- **Paid:** about 50,000 per 24 h, up to 18,000 a minute; raisable by service
  request.
- **Personalised mail** is one API call per person (one `submitEmail` can
  carry many recipients, but all get the same message).
- **No subscription management:** unsubscribe is ours to build.
- **Sources:** [Email Delivery FAQ](https://www.oracle.com/cloud/networking/email-delivery/faq/),
  [pricing](https://www.oracle.com/cloud/networking/email-delivery/).
