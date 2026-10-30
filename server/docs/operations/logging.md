---
title: Logging — pino, reading logs locally and on the VM
---

# Logging

## What the API writes
- **One JSON line per event** to stdout: `level`, an ISO `time`, `msg` and a few
  fields. On the VM, pm2 stores the lines; people read them through
  `pino-pretty`. Pretty output is never written to files.
- **Requests** (`src/configs/request-logger.ts`): one line when the response
  finishes, e.g. `GET /api/releases?limit=50 200 12ms`, with `req.id`, method,
  URL, status and the signed-in `userId`. **No headers or bodies.**
- **Levels:**

  | Level | What |
  |---|---|
  | `error` | 5xx responses, thrown errors, failed OCI or email calls |
  | `warn` | 4xx responses (bad input, sign-in failures, refusals) |
  | `info` | everything people do: page loads, saves, publishes |
  | `debug` | repeats on their own: publish polling, upload pieces, CORS preflights, 304s, `/api/health` |

  `LOG_LEVEL=info` (the default) shows actions and every problem. Set
  `LOG_LEVEL=debug` while investigating, then set it back.
- **Never logged:** cookies, `Authorization`, `Set-Cookie`, and any
  `password`, `token`, `accessToken` or `refreshToken` field. Request lines
  carry no headers at all, and `REDACT_PATHS` in `src/configs/logger.ts`
  removes these anywhere else as a safety net.
- **Where it's pretty:** only in a terminal outside production
  (`npm run dev`). Anything else, pm2 included, gets plain JSON, even if
  `NODE_ENV` is missing.

## Locally
- `npm run dev` prints one coloured line per request:
  `12:34:48 WARN: GET /api/releases 401 19ms`.
- Keep `LOG_LEVEL=info` in `.env` for a quiet console; `debug` adds polling,
  upload pieces, preflights and health checks.

## On the VM
pm2 is configured on the VM itself, not in this repo. `<app>` is its process
name (`pm2 ls`).
1. **Deploy** the new build and `pm2 reload <app>`.
2. **Check the mode:** `pm2 env <app-id> | grep -E "NODE_ENV|LOG_LEVEL"`.
   `NODE_ENV` should be `production`, and `LOG_LEVEL` `info` (set it in
   `server/.env`, then `pm2 restart <app> --update-env`).
3. **Read** the last lines, then live, one readable line per event:
   ```
   pm2 logs <app> --raw --lines 200 | npx pino-pretty -t SYS:standard -i req,res,responseTime
   ```
   Add `-L warn` for warnings and errors only. A shell alias saves typing:
   `alias applogs='pm2 logs <app> --raw --lines 200 | npx pino-pretty -t SYS:standard -i req,res,responseTime'`.
4. **Search the files** (`~/.pm2/logs/<app>-out.log` and `-error.log`, one
   JSON object per line). Levels are numbers there: 20 debug, 30 info,
   40 warn, 50 error.
   ```
   grep '"level":50' ~/.pm2/logs/<app>-out.log | npx pino-pretty   # errors
   grep 'publish' ~/.pm2/logs/<app>-out.log | npx pino-pretty
   ```
5. **Rotation**, if not set up yet:
   ```
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 20M
   pm2 set pm2-logrotate:retain 14
   pm2 set pm2-logrotate:compress true
   ```
6. **Logs written before 2026-10-30** hold full request headers, session
   cookies included. Clear them once with `pm2 flush <app>`.
