import pino from "pino";
import { env } from "./env.js";

/**
 * App-wide logger (pino).
 *
 * - test: silent — keeps test output readable.
 * - production: raw ndjson to stdout — structured, for log aggregation.
 * - development: pretty-printed via pino-pretty (colorized, human-readable
 *   timestamps) — the transport only activates outside production/test.
 *
 * Level controlled by LOG_LEVEL. Request logs (pino-http) share this logger.
 */
export const logger = pino(
  env.NODE_ENV === "test"
    ? { level: "silent" }
    : env.NODE_ENV === "production"
      ? { level: env.LOG_LEVEL }
      : {
          level: env.LOG_LEVEL,
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss",
              ignore: "pid,hostname",
            },
          },
        },
);
