import { UserStatus } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import request, { type Response } from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import { createUser, promoteToAdmin, uniqueEmail } from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { createMockHubspotClient } from "../helpers/hubspot.js";
import { accessCookie } from "../helpers/http.js";
import {
  approveSignup,
  rejectSignup,
} from "../../src/services/auth/admin-signups.service.js";

beforeAll(async () => {
  await resetDb();
});

// A free-mail signup that verified its email and set a password
async function pendingSignup(email: string) {
  return createUser(email, { status: "PENDING_APPROVAL" });
}

async function adminAuthHeader() {
  const admin = await promoteToAdmin(await createUser(uniqueEmail("admin")));
  return { Cookie: accessCookie(admin.accessToken) };
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
      .set("Cookie", accessCookie(customer.accessToken));
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
      .set("Cookie", accessCookie(generateAccessToken(dev.id, "DEV")));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/auth/admin/signups/pending (pagination + search)", () => {
  it("walks the queue with a cursor, oldest first, without gaps", async () => {
    const headers = await adminAuthHeader();
    // Isolate this test's rows with a unique search token
    const tag = `pg${Date.now()}`;
    const emails: string[] = [];
    const base = Date.now() - 60_000;
    for (let i = 0; i < 5; i++) {
      const email = uniqueEmail(`${tag}-${i}`);
      const user = await pendingSignup(email);
      // Distinct timestamps so the expected order is deterministic
      await prisma.user.update({
        where: { id: user.id },
        data: { createdAt: new Date(base + i * 1000) },
      });
      emails.push(email);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Response = await request(app)
        .get("/api/auth/admin/signups/pending")
        .query({ limit: 2, q: tag, ...(cursor ? { cursor } : {}) })
        .set(headers);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(5);
      seen.push(
        ...res.body.data.signups.map((s: { email: string }) => s.email),
      );
      cursor = res.body.data.nextCursor;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toEqual(emails);
  });

  it("searches by email, first name and full name", async () => {
    const headers = await adminAuthHeader();
    const email = uniqueEmail("searchable");
    const user = await pendingSignup(email);
    await prisma.user.update({
      where: { id: user.id },
      data: { firstName: "Zebulon", lastName: "Quartz" },
    });

    for (const q of [email.toUpperCase(), "zebulon", "Zebulon quartz"]) {
      const res = await request(app)
        .get("/api/auth/admin/signups/pending")
        .query({ q })
        .set(headers);
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(1);
      expect(res.body.data.signups[0].email).toBe(email);
    }

    const none = await request(app)
      .get("/api/auth/admin/signups/pending")
      .query({ q: "zebulon nobody" })
      .set(headers);
    expect(none.body.data).toEqual({ signups: [], nextCursor: null, total: 0 });
  });

  it("validates limit and cursor", async () => {
    const headers = await adminAuthHeader();
    for (const query of [{ limit: 0 }, { limit: 51 }, { limit: "abc" }]) {
      const res = await request(app)
        .get("/api/auth/admin/signups/pending")
        .query(query)
        .set(headers);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
    }
    const bad = await request(app)
      .get("/api/auth/admin/signups/pending")
      .query({ cursor: "garbage" })
      .set(headers);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_CURSOR");
  });
});

describe("POST /api/auth/admin/signups/:id/approve", () => {
  it("approves: the account is ACTIVE and can sign in", async () => {
    const headers = await adminAuthHeader();
    const user = await pendingSignup(uniqueEmail("approve"));

    const before = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(before.status).toBe(403);
    expect(before.body.code).toBe("ACCOUNT_PENDING_APPROVAL");

    const res = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/approve`)
      .set(headers);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("ACTIVE");
    expect(res.body.data).not.toHaveProperty("password");

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe(UserStatus.ACTIVE);
    expect(
      await prisma.setPasswordToken.count({ where: { userId: user.id } }),
    ).toBe(0);

    const after = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(after.status).toBe(200);
  });

  it("emails the person and creates the HubSpot contact", async () => {
    const sender = createMockEmailSender();
    const hubspot = createMockHubspotClient();
    const user = await pendingSignup(uniqueEmail("approve-notify"));

    await approveSignup(user.id, sender, hubspot);

    expect(sender.sent).toEqual([
      {
        kind: "welcome",
        email: user.email,
        firstName: "Test",
        url: "http://localhost:5173/catalog",
      },
    ]);
    expect(hubspot.upserted.map((c) => c.email)).toEqual([user.email]);
  });

  it("still activates when the email and HubSpot both fail", async () => {
    const sender = createMockEmailSender();
    sender.sendWelcomeEmail = async () => {
      throw new Error("smtp down");
    };
    const hubspot = createMockHubspotClient();
    hubspot.upsertContact = async () => {
      throw new Error("hubspot down");
    };
    const user = await pendingSignup(uniqueEmail("approve-fail"));

    await expect(
      approveSignup(user.id, sender, hubspot),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("approves only once: a second approval is SIGNUP_NOT_FOUND", async () => {
    const sender = createMockEmailSender();
    const user = await pendingSignup(uniqueEmail("approve-twice"));

    const results = await Promise.allSettled([
      approveSignup(user.id, sender, createMockHubspotClient()),
      approveSignup(user.id, sender, createMockHubspotClient()),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sender.sent.filter((e) => e.kind === "welcome")).toHaveLength(1);
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
    expect(row?.rejectionReason).toBeNull();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: user.password });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("ACCOUNT_BLOCKED");
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

  it("accepts an optional reason and rejects one over 500 characters", async () => {
    const headers = await adminAuthHeader();
    const user = await pendingSignup(uniqueEmail("reject-reason"));

    const tooLong = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/reject`)
      .set(headers)
      .send({ reason: "x".repeat(501) });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.code).toBe("VALIDATION_ERROR");

    const res = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/reject`)
      .set(headers)
      .send({ reason: "Please use your company email" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("BLOCKED");
    // Stored for audit, but internal only
    expect(res.body.data).not.toHaveProperty("rejectionReason");

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.rejectionReason).toBe("Please use your company email");
  });

  it("emails the person, including the reason when given", async () => {
    const sender = createMockEmailSender();
    const user = await pendingSignup(uniqueEmail("reject-email"));

    await rejectSignup(user.id, "Please use your company email", sender);

    expect(sender.sent).toEqual([
      {
        kind: "signupRejected",
        email: user.email,
        firstName: "Test",
        reason: "Please use your company email",
      },
    ]);
  });

  it("still blocks the user when the email fails", async () => {
    const sender = createMockEmailSender();
    sender.sendSignupRejectedEmail = async () => {
      throw new Error("smtp down");
    };
    const user = await pendingSignup(uniqueEmail("reject-email-fail"));

    const result = await rejectSignup(user.id, undefined, sender);

    expect(result.status).toBe("BLOCKED");
    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe(UserStatus.BLOCKED);
  });
});

describe("cross-role access", () => {
  it("a customer cannot approve their own signup", async () => {
    const user = await pendingSignup(uniqueEmail("self-approve"));
    // customer cannot even log in yet, but even a valid customer token fails
    const active = await createUser(uniqueEmail("active-cust"));
    const res = await request(app)
      .post(`/api/auth/admin/signups/${user.id}/approve`)
      .set("Cookie", accessCookie(active.accessToken));
    expect(res.status).toBe(403);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.status).toBe(UserStatus.PENDING_APPROVAL);
  });
});
