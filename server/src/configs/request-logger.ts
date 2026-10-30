import type { IncomingMessage, ServerResponse } from "node:http";
import type { Request } from "express";
import type { LevelWithSilent } from "pino";
import { pinoHttp, type Options } from "pino-http";
import { logger } from "./logger.js";

/**
 * Requests that repeat on their own while a page is open (polling, upload
 * pieces, health checks, CORS preflights): debug, so LOG_LEVEL=info shows
 * the actions people take and every problem, and debug shows the rest.
 */
const NOISY: { method?: string; path: RegExp }[] = [
  { method: "OPTIONS", path: /./ },
  { path: /^\/api\/health$/ },
  { method: "GET", path: /^\/api\/releases\/[^/]+\/publish-status$/ },
  { method: "GET", path: /^\/api\/releases\/publish-jobs$/ },
  {
    method: "PUT",
    path: /^\/api\/releases\/[^/]+\/uploads\/[^/]+\/parts\/\d+$/,
  },
];

const pathOf = (url: string) => url.split("?")[0];

/** A request's level: 5xx or a thrown error → error, 4xx → warn, noise → debug. */
export function requestLogLevel(
  method: string,
  url: string,
  status: number,
  error?: unknown,
): LevelWithSilent {
  if (error || status >= 500) return "error";
  if (status >= 400) return "warn";
  const path = pathOf(url);
  const noisy =
    status === 304 ||
    NOISY.some(
      (rule) =>
        (!rule.method || rule.method === method) && rule.path.test(path),
    );
  return noisy ? "debug" : "info";
}

/** The one-line message: "GET /api/releases 200 12ms". */
export const requestLogLine = (
  method: string,
  url: string,
  status: number,
  ms: number,
) => `${method} ${url} ${status} ${Math.round(ms)}ms`;

// Express rewrites req.url inside routers; originalUrl is what was asked for
const urlOf = (req: IncomingMessage) =>
  (req as Partial<Request>).originalUrl ?? req.url ?? "";

const userOf = (req: IncomingMessage) => (req as Partial<Request>).user?.userId;

/**
 * One short line per request: method, URL, status, time and the signed-in
 * user. No headers or bodies, so nothing secret (cookies, tokens) is logged.
 */
export const requestLogOptions: Options = {
  serializers: {
    req: (req: { id: unknown; method: string; url: string }) => ({
      id: req.id,
      method: req.method,
      url: req.url,
    }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
  customLogLevel: (req: IncomingMessage, res: ServerResponse, error) =>
    requestLogLevel(req.method ?? "", urlOf(req), res.statusCode, error),
  customSuccessMessage: (req, res, ms) =>
    requestLogLine(req.method ?? "", urlOf(req), res.statusCode, ms),
  customErrorMessage: (req, res, error) =>
    `${req.method} ${urlOf(req)} ${res.statusCode} ${error.message}`,
  customSuccessObject: (req, _res, value) => ({
    ...value,
    userId: userOf(req),
  }),
  customErrorObject: (req, _res, _error, value) => ({
    ...value,
    userId: userOf(req),
  }),
};

export const requestLogger = pinoHttp({ logger, ...requestLogOptions });
