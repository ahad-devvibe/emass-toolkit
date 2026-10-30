import { Writable } from "node:stream";
import express from "express";
import pino from "pino";
import { pinoHttp } from "pino-http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { REDACT_PATHS } from "../../src/configs/logger.js";
import { requestLogOptions } from "../../src/configs/request-logger.js";

/** An app with the real request-log options, writing JSON lines to `lines`. */
function loggedApp(level = "info") {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  const logger = pino(
    { level, base: undefined, redact: { paths: REDACT_PATHS, remove: true } },
    stream,
  );
  const app = express();
  app.use(pinoHttp({ logger, ...requestLogOptions }));
  app.get("/api/releases", (req, res) => {
    // A careless log of the whole request must not leak either
    req.log.info({ req: { headers: req.headers } }, "handler");
    res.json({ ok: true });
  });
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  return { app, lines };
}

describe("request logs", () => {
  it("writes one short line, without headers, cookies or tokens", async () => {
    const { app, lines } = loggedApp();

    await request(app)
      .get("/api/releases?limit=50")
      .set("Cookie", "accessToken=secret-jwt")
      .set("Authorization", "Bearer secret-bearer")
      .set("User-Agent", "Mozilla/5.0 test");

    const text = JSON.stringify(lines);
    expect(text).not.toContain("secret-jwt");
    expect(text).not.toContain("secret-bearer");

    const done = lines.find((line) => line.res);
    expect(done).toMatchObject({
      msg: expect.stringMatching(/^GET \/api\/releases\?limit=50 200 \d+ms$/),
      req: { method: "GET", url: "/api/releases?limit=50" },
      res: { statusCode: 200 },
    });
    expect(JSON.stringify(done)).not.toContain("Mozilla");
    expect(done).not.toHaveProperty("pid");
  });

  it("leaves health checks out at info", async () => {
    const { app, lines } = loggedApp("info");

    await request(app).get("/api/health");

    expect(lines).toEqual([]);
  });
});
