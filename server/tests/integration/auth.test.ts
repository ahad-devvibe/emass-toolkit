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
import {
  accessCookie,
  accessCookieFrom,
  refreshCookie,
  setCookies,
} from "../helpers/http.js";

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

describe("GET /api/auth/captcha", () => {
  it("returns an SVG data-uri and sets a captcha cookie", async () => {
    const res = await request(app).get("/api/auth/captcha");

    expect(res.status).toBe(200);
    expect(res.body.data.image).toMatch(/^data:image\/svg\+xml;base64,/);
    const cookie = setCookies(res.headers).find((c) =>
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
    expect(res.body.data).not.toHaveProperty("accessToken");
    expect(res.body.data.user.email).toBe(email);
    const access = setCookies(res.headers).find((c) =>
      c.startsWith("accessToken="),
    );
    expect(access).toContain("HttpOnly");
    expect(access).toContain("Path=/api;");
    expect(access).toContain("SameSite=Strict");
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(
      setCookies(res.headers).some((c) => c.startsWith("refreshToken=")),
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
      .set("Cookie", accessCookie(user.accessToken));

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

  it("ignores a Bearer header: only the cookie authenticates", async () => {
    const user = await createUser(uniqueEmail("bearer"));
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${user.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_MISSING");
  });

  it("rejects an invalid token", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", accessCookie("not-a-token"));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_INVALID");
  });
});

describe("refresh + logout", () => {
  async function loginCookie(prefix: string) {
    const email = uniqueEmail(prefix);
    const user = await createUser(email);
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });
    return { user, login, cookie: refreshCookie(login.headers) };
  }

  it("keeps both tokens out of response bodies", async () => {
    const { login, cookie } = await loginCookie("session-body");
    expect(login.body.data).not.toHaveProperty("refreshToken");
    expect(login.body.data).not.toHaveProperty("accessToken");
    const raw = setCookies(login.headers).find((c) => c.startsWith(cookie));
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("Path=/api/auth;");

    // Refresh answers with fresh cookies and an empty body
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).not.toHaveProperty("data");
    const access = accessCookieFrom(refreshed.headers);
    const me = await request(app).get("/api/auth/me").set("Cookie", access);
    expect(me.status).toBe(200);
  });

  it("rotates via the cookie and revokes every session on reuse", async () => {
    const { user, cookie } = await loginCookie("session-reuse");

    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie);
    expect(refreshed.status).toBe(200);
    const rotated = refreshCookie(refreshed.headers);
    expect(rotated).not.toBe(cookie);

    const reused = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie);
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe("REFRESH_TOKEN_REUSED");

    // Reuse revokes the whole family, including the freshly rotated token
    const afterReuse = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", rotated);
    expect(afterReuse.status).toBe(401);
    expect(
      await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it("lets only one of two concurrent refreshes win", async () => {
    const { cookie } = await loginCookie("session-race");

    const results = await Promise.all([
      request(app).post("/api/auth/refresh").set("Cookie", cookie),
      request(app).post("/api/auth/refresh").set("Cookie", cookie),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 401]);
    expect(results.find((r) => r.status === 401)?.body.code).toBe(
      "REFRESH_TOKEN_REUSED",
    );
  });

  it("revokes the refresh token on logout via the cookie", async () => {
    const { user, cookie } = await loginCookie("session-logout");

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);
    expect(logout.status).toBe(200);
    // Both cookies are cleared (expired) on their own paths
    const cleared = setCookies(logout.headers);
    expect(
      cleared.some(
        (c) => c.startsWith("accessToken=;") && c.includes("Path=/api;"),
      ),
    ).toBe(true);
    expect(
      cleared.some(
        (c) => c.startsWith("refreshToken=;") && c.includes("Path=/api/auth;"),
      ),
    ).toBe(true);
    expect(
      await prisma.refreshToken.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);

    const afterLogout = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie);
    expect(afterLogout.status).toBe(401);
  });

  it("ignores a refresh token sent in the body", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "anything" });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REFRESH_TOKEN_MISSING");
  });
});

describe("CORS", () => {
  it("rejects a public origin with a 403 error envelope", async () => {
    const res = await request(app)
      .get("/api/auth/captcha")
      .set("Origin", "https://evil.example.com");
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      statusCode: 403,
      code: "CORS_ORIGIN_DENIED",
    });
  });

  it("allows LAN and localhost origins with credentials", async () => {
    const res = await request(app)
      .get("/api/auth/captcha")
      .set("Origin", "http://192.168.18.15:5173");
    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("cross-user isolation", () => {
  it("another user's access token only exposes that user", async () => {
    const a = await createUser(uniqueEmail("iso-a"));
    const b = await createUser(uniqueEmail("iso-b"));

    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", accessCookie(a.accessToken));

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
      .set("Cookie", accessCookie(admin.accessToken));
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
        useCase: "Evaluating EMASS for an edge AI camera",
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
        useCase: "Evaluating EMASS for an edge AI camera",
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
    expect(fe.useCase).toEqual(["Use case is required"]);
  });

  it("rejects a well-formed but unassigned country code", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .set("Cookie", [`captcha=${captchaCookieFor(TEST_CAPTCHA_CODE)}`])
      .send({
        email: uniqueEmail("zz"),
        firstName: "A",
        lastName: "B",
        country: "ZZ",
        companyName: "Co",
        jobTitle: "Dev",
        useCase: "Evaluating EMASS for an edge AI camera",
        captcha: TEST_CAPTCHA_CODE,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.fieldErrors.country).toEqual([
      "Country must be a valid ISO 3166-1 alpha-2 code",
    ]);
  });
});
