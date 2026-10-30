import pino from "pino";
import { env } from "./env.js";

/**
 * Never written to the logs, whatever gets passed in: session cookies,
 * Authorization headers and secrets in logged objects. Removed, not masked.
 */
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  'res.headers["set-cookie"]',
  "*.password",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
];

/**
 * App-wide logger (pino).
 *
 * - test: silent — keeps test output readable.
 * - a terminal outside production: pretty-printed via pino-pretty
 *   (colourised, short timestamps).
 * - anything else (production, pm2, piped output): one JSON line per event
 *   with an ISO time, so files stay plain and `pino-pretty` reads them back.
 *   Pretty output never ends up in pm2's log files, even without NODE_ENV.
 *
 * pid and hostname are left out (pm2 knows the process). Level controlled by
 * LOG_LEVEL. Request logs (request-logger.ts) share this logger.
 */
const pretty = env.NODE_ENV !== "production" && Boolean(process.stdout.isTTY);

export const logger = pino(
  env.NODE_ENV === "test"
    ? { level: "silent" }
    : {
        level: env.LOG_LEVEL,
        base: undefined,
        redact: { paths: REDACT_PATHS, remove: true },
        ...(pretty
          ? {
              transport: {
                target: "pino-pretty",
                options: {
                  colorize: true,
                  translateTime: "SYS:HH:MM:ss",
                  // The message already says it: "GET /api/x 200 12ms"
                  ignore: "req,res,responseTime",
                },
              },
            }
          : { timestamp: pino.stdTimeFunctions.isoTime }),
      },
);
