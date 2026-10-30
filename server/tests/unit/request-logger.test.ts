import { describe, expect, it } from "vitest";
import {
  requestLogLevel,
  requestLogLine,
} from "../../src/configs/request-logger.js";

describe("requestLogLevel", () => {
  it("raises failures: 5xx and errors to error, 4xx to warn", () => {
    expect(requestLogLevel("GET", "/api/releases", 500)).toBe("error");
    expect(
      requestLogLevel("GET", "/api/releases", 200, new Error("boom")),
    ).toBe("error");
    expect(requestLogLevel("POST", "/api/auth/login", 401)).toBe("warn");
  });

  it("keeps actions at info", () => {
    expect(requestLogLevel("GET", "/api/releases?limit=50", 200)).toBe("info");
    expect(requestLogLevel("POST", "/api/releases/r1/publish", 202)).toBe(
      "info",
    );
  });

  it("drops polling, upload pieces, preflights, 304s and health checks to debug", () => {
    for (const [method, url, status] of [
      ["GET", "/api/releases/r1/publish-status", 200],
      ["GET", "/api/releases/publish-jobs", 200],
      ["PUT", "/api/releases/r1/uploads/u1/parts/3", 200],
      ["OPTIONS", "/api/releases", 204],
      ["GET", "/api/health", 200],
      ["GET", "/api/releases?limit=1", 304],
    ] as const) {
      expect(requestLogLevel(method, url, status), `${method} ${url}`).toBe(
        "debug",
      );
    }
  });

  it("still reports a failing poll", () => {
    expect(requestLogLevel("GET", "/api/releases/r1/publish-status", 500)).toBe(
      "error",
    );
  });
});

describe("requestLogLine", () => {
  it("reads as one short line", () => {
    expect(requestLogLine("GET", "/api/releases", 200, 12.4)).toBe(
      "GET /api/releases 200 12ms",
    );
  });
});
