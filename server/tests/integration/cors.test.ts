import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { TEST_PASSWORD, createUser } from "../helpers/auth.js";
import { resetDb } from "../helpers/resetDb.js";

beforeAll(resetDb);

const ALLOWED = "https://emassportal.nanoveu.com";

describe("CORS", () => {
  it("lets a hosted frontend call the API with cookies", async () => {
    const res = await request(app)
      .options("/api/health")
      .set("Origin", ALLOWED)
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("refuses any other site", async () => {
    const res = await request(app)
      .get("/api/health")
      .set("Origin", `${ALLOWED}.evil.example`);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CORS_ORIGIN_DENIED" });
  });

  // With SameSite=None cookies this check is what stops cross-site forgery
  it("refuses a write from another site before the route runs", async () => {
    const user = await createUser("csrf@example.com");

    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "CORS_ORIGIN_DENIED" });
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(
      await prisma.refreshToken.count({ where: { userId: user.id } }),
    ).toBe(0);
  });
});
