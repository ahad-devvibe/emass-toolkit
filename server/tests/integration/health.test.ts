import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../src/app.js";

describe("GET /api/health", () => {
  it("returns 200 with { success, statusCode, message } and no data key", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, statusCode: 200, message: "OK" });
    expect(res.body).not.toHaveProperty("data");
    expect(res.body).not.toHaveProperty("code");
  });
});
