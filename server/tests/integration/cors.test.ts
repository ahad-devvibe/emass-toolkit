import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../../src/app.js";

describe("CORS", () => {
  it("lets the hosted frontend call the API with cookies", async () => {
    const res = await request(app)
      .options("/api/health")
      .set("Origin", "https://demo.nanoveu.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(
      "https://demo.nanoveu.com",
    );
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("refuses any other site", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Origin", "https://demo.nanoveu.com.evil.example");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CORS_ORIGIN_DENIED" });
  });
});
