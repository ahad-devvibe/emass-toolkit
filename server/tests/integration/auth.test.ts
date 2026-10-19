import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  TEST_CAPTCHA_CODE,
  captchaCookieFor,
  createUser,
  promoteToAdmin,
  seedDomainPoliciesForTest,
  uniqueEmail,
} from "../helpers/auth.js";

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

describe("GET /api/auth/captcha", () => {
  it("returns an SVG data-uri and sets a captcha cookie", async () => {
    const res = await request(app).get("/api/auth/captcha");

    expect(res.status).toBe(200);
    expect(res.body.data.image).toMatch(/^data:image\/svg\+xml;base64,/);
    const cookie = res.headers["set-cookie"].find((c: string) =>
      c.startsWith("captcha="),
    );
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
  });
});

describe("POST /api/auth/login", () => {
  it("logs a customer in and issues cookies + tokens", async () => {
    const email = uniqueEmail("login");
    await createUser(email);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.data.mfaRequired).toBe(false);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(
      res.headers["set-cookie"].some((c: string) =>
        c.startsWith("refreshToken="),
      ),
    ).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const email = uniqueEmail("login-bad");
    await createUser(email);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("blocks PENDING_APPROVAL accounts", async () => {
    const email = uniqueEmail("login-pending");
    await createUser(email, { status: "PENDING_APPROVAL" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_PENDING_APPROVAL");
  });

  it("blocks PENDING_SET_PASSWORD accounts", async () => {
    const email = uniqueEmail("login-unset");
    await createUser(email, { status: "PENDING_SET_PASSWORD" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_NOT_ACTIVE");
  });

  it("blocks BLOCKED accounts", async () => {
    const email = uniqueEmail("login-blocked");
    await createUser(email, { status: "BLOCKED" });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BLOCKED");
  });

  it("treats passwordless accounts as invalid credentials", async () => {
    const email = uniqueEmail("login-nopass");
    await createUser(email, { password: null });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "whatever123" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the current user", async () => {
    const user = await createUser(uniqueEmail("me"));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${user.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(user.email);
    expect(res.body.data.role).toBe("CUSTOMER");
    expect(res.body.data).not.toHaveProperty("password");
  });

  it("rejects a missing token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_MISSING");
  });

  it("rejects an invalid token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", "Bearer not-a-token");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });
});

describe("refresh + logout", () => {
  it("rotates the refresh token and logs out", async () => {
    const email = uniqueEmail("session");
    await createUser(email);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });
    const refreshToken = login.body.data.refreshToken as string;

    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(refreshToken);

    const reused = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe("REFRESH_TOKEN_REUSED");

    const logout = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: refreshed.body.data.refreshToken });
    expect(logout.status).toBe(200);

    const afterLogout = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: refreshed.body.data.refreshToken });
    expect(afterLogout.status).toBe(401);
  });
});

describe("cross-user isolation", () => {
  it("another user's access token only exposes that user", async () => {
    const a = await createUser(uniqueEmail("iso-a"));
    const b = await createUser(uniqueEmail("iso-b"));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${a.accessToken}`);

    expect(res.body.data.id).toBe(a.id);
    expect(res.body.data.id).not.toBe(b.id);
    const bRow = await prisma.user.findUnique({ where: { id: b.id } });
    expect(bRow?.email).toBe(b.email);
  });

  it("promoted roles round-trip in the token", async () => {
    const admin = await promoteToAdmin(
      await createUser(uniqueEmail("iso-admin")),
    );
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.body.data.role).toBe("ADMIN");
  });
});

describe("POST /api/auth/signup (captcha wiring)", () => {
  it("rejects signup without a captcha cookie", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({
        email: uniqueEmail("nocap"),
        firstName: "A",
        lastName: "B",
        country: "US",
        companyName: "Co",
        jobTitle: "Dev",
        captcha: TEST_CAPTCHA_CODE,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CAPTCHA_REQUIRED");
  });

  it("rejects signup with a wrong captcha code", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .set("Cookie", [`captcha=${captchaCookieFor("REALCODE")}`])
      .send({
        email: uniqueEmail("badcap"),
        firstName: "A",
        lastName: "B",
        country: "US",
        companyName: "Co",
        jobTitle: "Dev",
        captcha: "WRONG12",
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CAPTCHA_INVALID");
  });

  it("validates required fields distinctly", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .set("Cookie", [`captcha=${captchaCookieFor(TEST_CAPTCHA_CODE)}`])
      .send({ captcha: TEST_CAPTCHA_CODE });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    const fe = res.body.details.fieldErrors;
    expect(fe.email).toEqual(["Email is required"]);
    expect(fe.firstName).toEqual(["First name is required"]);
    expect(fe.lastName).toEqual(["Last name is required"]);
    expect(fe.country).toEqual(["Country is required"]);
    expect(fe.companyName).toEqual(["Company name is required"]);
    expect(fe.jobTitle).toEqual(["Job title is required"]);
  });
});
