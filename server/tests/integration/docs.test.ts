import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

describe("GET /api/docs", () => {
  it("returns the generated Redoc HTML", async () => {
    const res = await request(app).get("/api/docs");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.text).toContain("<title>EMASS Toolkit API</title>");
    expect(res.text).toContain("redoc");
  });
});
