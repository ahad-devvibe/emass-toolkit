import pino from "pino";
import { env } from "./env.js";

/**
 * App-wide logger (pino). JSON to stdout — pipe through `pino-pretty` in dev if
 * you want human-readable output. Silent under NODE_ENV=test to keep test
 * output readable. Level controlled by LOG_LEVEL.
 */
export const logger = pino({
  level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL,
});
