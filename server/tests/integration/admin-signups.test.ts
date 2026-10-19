import { UserStatus } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import { createUser, promoteToAdmin, uniqueEmail } from "../helpers/auth.js";

beforeAll(async () => {
  await resetDb();
});

async function pendingSignup(email: string) {
  const user = await createUser(email, {
    status: "PENDING_APPROVAL",
    password: null,
    emailVerified: false,
  });
  return user;
}

async function adminAuthHeader() {
  const admin = await promoteToAdmin(await createUser(uniqueEmail("admin")));
  return { Authorization: `Bearer ${admin.accessToken}` };
}

describe("GET /api/auth/admin/signups/pending", () => {
  it("lists only PENDING_APPROVAL users (ADMIN only)", async () => {
    const headers = await adminAuthHeader();
    const pendingEmail = uniqueEmail("pend-list");
    await pendingSignup(pendingEmail);
    await createUser(uniqueEmail("active"));

    const res = await request(app)
      .get("/api/auth/admin/signups/pending")
      .set(headers);

    expect(res.status).toBe(200);
    const emails = res.body.data.signups.map((s: { email: string }) => s.email);
    expect(emails).toContain(pendingEmail);
    expect(
      res.body.data.signups.every(
        (s: { status: string }) => s.status === "PENDING_APPROVAL",
      ),
    ).toBe(true);
    expect(res.body.data.signups[0]).not.toHaveProperty("password");
  });

  it("forbids customers and requires auth", async () => {
    const customer = await createUser(uniqueEmail("cust"));
    const forbidden = await request(app)
      .get("/api/auth/admin/signups/pending")
      .set("Authorization", `Bearer ${customer.accessToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.code).toBe("FORBIDDEN");

    const anonymous = await request(app).get("/api/auth/admin/signups/pending");
    expect(anonymous.status).toBe(401);
  });

  it("forbids DEV staff", async () => {
    const { generateAccessToken } =
      await import("../../src/services/auth/auth.utils.js");
    const dev = await createUser(uniqueEmail("dev"));
    await prisma.user.update({
      where: { id: dev.id },
      data: { role: "DEV" },
    });
    const res = await request(app)
      .get("/api/auth/admin/signups/pending")
      .set("Authorization", `Bearer ${generateAccessToken(dev.id, "DEV")}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/auth/admin/signups/:id/approve", () => {
  it("approves: status PENDING_SET_PASSWORD + set-password email", async () => {
    const headers = await adminAuthHeader();
    const user = await pendingSignup(uniqueEmail("approve"));

    const res = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/approve`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("PENDING_SET_PASSWORD");

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe(UserStatus.PENDING_SET_PASSWORD);

    const tokens = await prisma.setPasswordToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens).toHaveLength(1);
  });

  it("404s for non-pending users", async () => {
    const headers = await adminAuthHeader();
    const active = await createUser(uniqueEmail("approve-active"));

    const res = await request(app)
      .post(`/api/auth/admin/signups/${active.id}/approve`)
      .set(headers);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SIGNUP_NOT_FOUND");
  });
});

describe("POST /api/auth/admin/signups/:id/reject", () => {
  it("rejects: status BLOCKED", async () => {
    const headers = await adminAuthHeader();
    const user = await pendingSignup(uniqueEmail("reject"));

    const res = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/reject`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("BLOCKED");

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe(UserStatus.BLOCKED);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "password123" });
    expect(login.status).toBe(401);
  });

  it("404s for unknown ids", async () => {
    const headers = await adminAuthHeader();
    const res = await request(app)
      .post(
        "/api/auth/admin/signups/00000000-0000-0000-0000-000000000000/reject",
      )
      .set(headers);
    expect(res.status).toBe(404);
  });
});

describe("cross-role access", () => {
  it("a customer cannot approve their own signup", async () => {
    const user = await pendingSignup(uniqueEmail("self-approve"));
    // customer cannot even log in yet, but even a valid customer token fails
    const active = await createUser(uniqueEmail("active-cust"));
    const res = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/approve`)
      .set("Authorization", `Bearer ${active.accessToken}`);
    expect(res.status).toBe(403);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe(UserStatus.PENDING_APPROVAL);
  });
});
