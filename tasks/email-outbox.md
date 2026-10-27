# Task: durable email outbox for bulk mail (rollback + new-release announcements)

**Status:** planned, not started (2026-10-26). To be refined before implementation.

**Related:** today’s rollback mail is sent in memory by `server/src/services/releases/rollback-notify.service.ts`; this task replaces that. OCI limits and pricing are summarised in “OCI Email Delivery facts” below.

## Context
Two bulk events send one email per customer: **release rollback** (today) and **new-release announcement** (next). Today rollback mail is an in-memory loop after the response:
- a restart loses the rest;
- a throttle or OCI error drops that person;
- nothing records who failed, so nothing can be retried.

**Production-grade, reasonable-effort fix: the transactional outbox pattern.** Every email to send is a **row in Postgres** first. A small **worker** inside the API process sends the rows at a controlled pace and records each outcome. Postgres is the queue, so there's no Redis, no separate service and no cron.

## What the "worker" is, and how it runs on the same Node.js thread
- **It's an async function, not a thread or process.** `drainOutbox()` loops: claim a few rows, send each, mark the result, repeat until nothing is due.
- **Node runs one JavaScript thread,** but almost all of the worker's time is spent **awaiting I/O**: the OCI HTTPS call (about 150–300 ms) and the pacing delay. While it awaits, the event loop keeps serving API requests.
- **CPU per email is tiny:** rendering a template and serialising JSON takes well under 1 ms. So 1,000 emails cost about 1 s of total CPU, spread over minutes, and **API latency isn't affected**.
- **Starting it (no cron, no polling while idle):**
  - **`emailWorker.kick()`** is called right after a transaction that enqueued rows commits, and **once at server start-up** (to resume after a restart or deploy).
  - **One loop per process:** a module flag (`running`) ensures a second `kick()` while a drain is running just returns, because that drain picks the new rows up anyway.
  - **When nothing is due:** if rows are only waiting for a retry time, the worker sets **one** `setTimeout` for the earliest `nextAttemptAt` and stops. With no pending rows there is no timer at all, so it costs nothing at rest.
- **Pacing ("a reasonable delay between each mail"):**
  - a per-process limiter allows `EMAIL_BULK_PER_MINUTE` sends (default **120**, a 500 ms gap); the worker waits the remaining gap before each send;
  - set it to suit the tenancy: about 10/min on a free trial, hundreds on a paid account.
  - A **daily cap**, `EMAIL_BULK_DAILY_CAP`, stops bulk sends once reached (the rest wait until the next day), so bulk mail can never use up the quota that **sign-in codes** need. Auth mail stays direct and instant, outside the outbox.

## The table
**`EmailOutbox`** (one migration, the user runs it):
| Column | Purpose |
|---|---|
| `id` | |
| `kind` (`RELEASE_WITHDRAWN` / `RELEASE_ANNOUNCED`) | which template |
| `priority` Int | rollback 0 (urgent), announcement 10 |
| `batchId` | e.g. the rollback event id, so a batch's progress is one query |
| `userId?` / `toEmail` / `payload` Json | who, and the template input (versions, URL, message) |
| `status` (`PENDING` / `SENDING` / `SENT` / `FAILED`) | |
| `attempts`, `nextAttemptAt`, `lockedUntil`, `lastError`, `sentAt`, `createdAt` | retry, lease and audit |

- **Indexes:**
  - `(status, nextAttemptAt, priority)`, for claiming due rows;
  - `(batchId, status)`, for progress.
- **Uniqueness:** `@@unique([batchId, toEmail])`, so re-running an enqueue can't double-queue a person.

## The flow
1. **Rollback:** inside the rollback transaction, **one statement** queues everyone:
   `INSERT INTO "EmailOutbox" (…) SELECT DISTINCT … FROM "Download" d JOIN "User" u … WHERE d."releaseId" = $1 AND u.status = 'ACTIVE'`.
   - It's atomic with the rollback: both happen, or neither.
   - It's fast for 1,000 users (one round trip).
   - Commit, then `kick()`.
2. **Claim:** a batch of 25 due rows: `UPDATE … SET status='SENDING', lockedUntil=now()+5 min WHERE id IN (SELECT id … WHERE status IN ('PENDING','SENDING') AND nextAttemptAt <= now() AND (lockedUntil IS NULL OR lockedUntil < now()) ORDER BY priority, createdAt LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING *`.
3. **Send each** (paced), then mark the outcome:
   - success → `SENT`;
   - 429 / 5xx / network → `PENDING`, `attempts+1`, `nextAttemptAt` = now + backoff (1 min, 5 min, 30 min, 2 h);
   - after 5 attempts, or on a 4xx like an invalid address → `FAILED` with `lastError`.
4. **When a batch has nothing left PENDING or SENDING,** the worker writes or updates the `CUSTOMERS_NOTIFIED` event: "Emailed 998 customers (2 failed)".
   - **Retry failed (later):** an admin action resets that batch's `FAILED` rows to `PENDING` and calls `kick()`.

## Two events at the same time (rollback plus announcement)
- **Both enqueue into the same table.** One worker per process drains both, **rollback first** (`priority`), then the announcement, interleaving by `createdAt` within a priority.
- **Two workers at once** (two API instances, or an old and a new process during a deploy): `FOR UPDATE SKIP LOCKED` hands each worker **different rows**, so there are no duplicates.
- **A worker dies mid-send:** its rows' `lockedUntil` lease expires, and another worker (or the next start-up) re-claims them.
- **Guarantee:** at-least-once. A duplicate email is possible only if the process dies in the instant after OCI accepted the mail and before the row was marked `SENT`. That's rare and acceptable for notices.
- **Pacing with several instances:** the limiter is per process, so N instances send at N × the configured rate. Today it's one VM; with more, divide the setting.

## Expected numbers: 1,000 customers × 2 concurrent events = 2,000 emails
*These are estimates; the benchmark below measures them.*
| What | Estimate |
|---|---|
| Queue 1,000 rollback rows (`INSERT … SELECT`, inside the rollback) | about 50–150 ms; the rollback request stays well under 1 s |
| Queue 1,000 announcement rows | same |
| Drain 2,000 at 120/min | about **17 min** (rollback's 1,000 done in about 8 min) |
| …at 300/min (a paid account) | about **7 min**; at 600/min (with 2 sends in flight) about 3.5 min |
| DB work | about 2,080 small statements spread over the drain: claims of 25, plus one update per email |
| Memory | one claimed batch (25 rows) |
| Event-loop time per email | under 1 ms, so API p95 latency changes by less than 1 ms |
| Throughput ceiling | with 1 send in flight, OCI latency caps about 3–6/s. Raise `EMAIL_BULK_CONCURRENCY` (default 1, max 4) only if the pace setting needs it |

## Build steps
1. **Schema and migration:** `EmailOutbox` plus its enums.
2. **`src/services/email/email-outbox.service.ts`:** `enqueueRollbackNotices(tx, …)` (the `INSERT … SELECT`), `claimDue(limit)`, `markSent`, `markRetry`, `markFailed`, and batch progress.
3. **`src/services/email/email-worker.ts`:** the `kick()` and `drainOutbox()` loop, the limiter, the daily cap, the one-shot retry timer, and `stop()` for graceful shutdown (it finishes the current send, then exits).
4. **Wiring:**
   - `rollbackRelease` enqueues inside its transaction and kicks after commit;
   - `server.ts` kicks once on start and stops on SIGTERM;
   - `rollback-notify.service.ts` is removed, its job taken over by the outbox and worker;
   - env: `EMAIL_BULK_PER_MINUTE`, `EMAIL_BULK_DAILY_CAP`, `EMAIL_BULK_CONCURRENCY`, validated in `env.ts` and listed in `.env.example`.
5. **Announcements are a separate later task** on this outbox: subscriptions, consent, unsubscribe.

## Tests
- **Integration:**
  - the rollback enqueues exactly the active downloaders, in the same transaction (a failed rollback enqueues nothing);
  - the drain marks rows `SENT`;
  - 429 → `PENDING` with a later `nextAttemptAt`, then `SENT` on the retry;
  - 400 → `FAILED`;
  - two concurrent `drainOutbox()` → every email sent exactly once;
  - an expired lease is re-claimed;
  - the daily cap stops sending and leaves the rest `PENDING`;
  - priority: rollback rows go before announcement rows;
  - the batch completes → `CUSTOMERS_NOTIFIED` with counts.
- **Unit:** the limiter and the backoff schedule, with a fake clock.

## Benchmark (`scripts/benchmark/email-outbox.ts`, run on the test DB)
- **Setup:**
  - seed 1,000 customers with downloads of release A; mark 1,000 subscribers of product B;
  - start **both** at once: roll back A (enqueue 1,000) and queue the announcement for B (1,000);
  - use a fake sender with 200 ms latency, 1% 429s and 0.2% 400s, and the pace at 600/min for the run;
  - in parallel, call `GET /api/health` every 50 ms.
- **Report:**
  - enqueue time per event;
  - total drain time, and when the rollback batch finished;
  - sent, retried and failed counts, with **duplicates = 0** (checked through the fake sender's log);
  - API p50 and p95 during the drain vs. idle;
  - DB statement count;
  - peak RSS.
- **Second run with two worker processes,** to show no duplicates across instances.

## Verification
- **Server tests:** `npx dotenv -e .env.test -- vitest run` (after migrations), then lint; then run the benchmark and record the results in `docs/operations/email-outbox.md`, alongside the settings (pace per tenancy tier).

## OCI Email Delivery facts (check against the current price list and your tenancy limits)

- **Cost:** a free allocation of about 3,000 emails a month (100 a day); the price list’s first tier is “first 3,100 emails”, then pay-as-you-go at cents per 1,000.
- **Free-trial tenancy:** 200 emails per rolling 24 h, at most 10 a minute.
- **Paid / enterprise tenancy:** 50,000 per 24 h, up to 18,000 a minute. Limits can be raised by a service request.
- **Bulk:** one `submitEmail` can carry many recipients, but the same message goes to all. Personalised mail is one call per person. There’s no unsubscribe or subscription management, so that’s ours to build.
- **Sources:**
  - [Email Delivery FAQ](https://www.oracle.com/cloud/networking/email-delivery/faq/)
  - [Email Delivery pricing](https://www.oracle.com/cloud/networking/email-delivery/)
  - [Free OCI email (APEX blog)](https://blogs.oracle.com/apex/post/free-oci-email-for-apex)

## Open questions (to refine)

1. **Pace defaults:** what should `EMAIL_BULK_PER_MINUTE` and `EMAIL_BULK_DAILY_CAP` be for our actual tenancy tier? Check Console → Governance → Limits → Email Delivery.
2. **Announcement audience:** product subscribers only, or also everyone who ever downloaded the product? The second needs legal sign-off on consent.
3. **Retry and backoff:** is the schedule (1 min, 5 min, 30 min, 2 h; 5 attempts) right?
4. **Who sends announcements:** HubSpot marketing email (lists, unsubscribe and analytics built in; needs Marketing Hub), or this outbox? Rollback notices stay in the outbox either way.
5. **Admin view:** a “Retry failed” action and a per-batch progress view: in this task or later?
