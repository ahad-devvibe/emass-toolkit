import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { emailService } from "../../src/services/email/email.service.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { requestPasswordReset } from "../../src/services/auth/password-reset.service.js";
import { hashToken } from "../../src/services/auth/auth.utils.js";
import { TEST_PASSWORD, createUser, uniqueEmail } from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { resetDb } from "../helpers/resetDb.js";

const NEW_PASSWORD = "newpass123";

/** Requests a reset through the service and returns the raw token from the link. */
async function issueResetToken(email: string): Promise<string> {
  const sender = createMockEmailSender();
  await requestPasswordReset(email, sender);
  const url = sender.lastUrl(email);
  if (!url) throw new Error(`no reset link sent to ${email}`);
  return new URL(url).searchParams.get("token")!;
}

function forgot(email: string) {
  return request(app).post("/api/auth/forgot-password").send({ email });
}

function check(token: unknown) {
  return request(app).post("/api/auth/reset-password/check").send({ token });
}

function reset(token: unknown, newPassword: unknown = NEW_PASSWORD) {
  return request(app)
    .post("/api/auth/reset-password")
    .send({ token, newPassword });
}

function login(email: string, password: string) {
  return request(app).post("/api/auth/login").send({ email, password });
}

/** Spies on the real sender used by the HTTP routes. */
function spyResetEmails() {
  vi.spyOn(emailService, "assertReady").mockResolvedValue(undefined);
  return vi
    .spyOn(emailService, "sendPasswordResetEmail")
    .mockResolvedValue(undefined);
}

const GENERIC_MESSAGE =
  "If an account exists for that email, we've sent a reset link";

beforeAll(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/forgot-password", () => {
  it("emails a 30-minute reset link to an active account", async () => {
    const email = uniqueEmail("forgot");
    const user = await createUser(email, { firstName: "Jane" });
    const send = spyResetEmails();

    const res = await forgot(email);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(send).toHaveBeenCalledOnce();
    const [to, firstName, url, minutes] = send.mock.calls[0];
    expect([to, firstName, minutes]).toEqual([email, "Jane", 30]);
    const token = new URL(url).searchParams.get("token")!;
    expect(url).toMatch(/\/reset-password\?token=/);

    const row = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).not.toBe(token);
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000 + 1000);
  });

  it("also emails a link to an account waiting for approval", async () => {
    const email = uniqueEmail("forgot-pending");
    await createUser(email, { status: "PENDING_APPROVAL" });
    const send = spyResetEmails();

    expect((await forgot(email)).status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([
    ["an unknown email", async () => uniqueEmail("forgot-unknown")],
    [
      "a blocked account",
      async () => {
        const email = uniqueEmail("forgot-blocked");
        await createUser(email, { status: "BLOCKED" });
        return email;
      },
    ],
    [
      "an unfinished signup (no password)",
      async () => {
        const email = uniqueEmail("forgot-unfinished");
        await createUser(email, {
          password: null,
          status: "PENDING_SET_PASSWORD",
        });
        return email;
      },
    ],
  ])("answers the same for %s and sends nothing", async (_, make) => {
    const email = await make();
    const send = spyResetEmails();

    const res = await forgot(email);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
    expect(send).not.toHaveBeenCalled();
  });

  it("still answers 200 when the email fails, so it can't reveal the account", async () => {
    const email = uniqueEmail("forgot-sendfail");
    await createUser(email);
    vi.spyOn(emailService, "assertReady").mockResolvedValue(undefined);
    vi.spyOn(emailService, "sendPasswordResetEmail").mockRejectedValue(
      new ApiError(502, "Unable to send email", "EMAIL_SEND_FAILED"),
    );

    const res = await forgot(email);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC_MESSAGE);
  });

  it("sends nothing for a second request within a minute", async () => {
    const email = uniqueEmail("forgot-cooldown");
    await createUser(email);
    const send = spyResetEmails();

    await forgot(email);
    const again = await forgot(email);

    expect(again.status).toBe(200);
    expect(send).toHaveBeenCalledOnce();
  });

  it("a new link replaces the previous one", async () => {
    const email = uniqueEmail("forgot-replace");
    const user = await createUser(email);
    const first = await issueResetToken(email);
    // Step past the one-minute quiet period
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 2 * 60_000) },
    });
    const second = await issueResetToken(email);

    expect((await check(first)).body.code).toBe("RESET_LINK_INVALID");
    expect((await check(second)).status).toBe(200);
  });

  it("validates the email", async () => {
    const missing = await request(app)
      .post("/api/auth/forgot-password")
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.details.fieldErrors.email).toContain(
      "Email is required",
    );
  });
});

describe("POST /api/auth/reset-password/check", () => {
  it("returns the account's email for a good link, without using it up", async () => {
    const email = uniqueEmail("check-ok");
    const user = await createUser(email);
    const token = await issueResetToken(email);

    const res = await check(token);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ email });
    const row = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.consumedAt).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const res = await check("not-a-real-token");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESET_LINK_INVALID");
  });

  it("rejects an expired link", async () => {
    const email = uniqueEmail("check-expired");
    const user = await createUser(email);
    const token = await issueResetToken(email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await check(token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESET_LINK_EXPIRED");
  });

  it("rejects the link once the account is blocked", async () => {
    const email = uniqueEmail("check-blocked");
    const user = await createUser(email);
    const token = await issueResetToken(email);
    await prisma.user.update({
      where: { id: user.id },
      data: { status: "BLOCKED" },
    });

    expect((await check(token)).body.code).toBe("RESET_LINK_INVALID");
  });

  it("tells a missing token from a wrong type", async () => {
    const missing = await request(app)
      .post("/api/auth/reset-password/check")
      .send({});
    expect(missing.body.details.fieldErrors.token).toContain(
      "Token is required",
    );
    const wrongType = await check(42);
    expect(wrongType.body.details.fieldErrors.token).toContain(
      "Invalid input: expected string, received number",
    );
  });
});

describe("POST /api/auth/reset-password", () => {
  it("sets the new password and signs out every session", async () => {
    const email = uniqueEmail("reset-happy");
    const user = await createUser(email);
    const session = await login(email, TEST_PASSWORD);
    expect(session.status).toBe(200);
    const token = await issueResetToken(email);

    const res = await reset(token);

    expect(res.status).toBe(200);
    expect((await login(email, TEST_PASSWORD)).status).toBe(401);
    const fresh = await login(email, NEW_PASSWORD);
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.user.id).toBe(user.id);
    // The session from before the reset was revoked
    const revoked = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: { not: null } },
    });
    expect(revoked).toBeGreaterThanOrEqual(1);
  });

  it("works once", async () => {
    const email = uniqueEmail("reset-once");
    await createUser(email);
    const token = await issueResetToken(email);

    expect((await reset(token, "firstpass123")).status).toBe(200);
    const second = await reset(token, "secondpass123");
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("RESET_LINK_INVALID");
    expect((await login(email, "firstpass123")).status).toBe(200);
  });

  it("lets only one of two simultaneous submits through", async () => {
    const email = uniqueEmail("reset-race");
    await createUser(email);
    const token = await issueResetToken(email);

    const results = await Promise.all([
      reset(token, "racepass111"),
      reset(token, "racepass222"),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it("refuses the current password without using the link up", async () => {
    const email = uniqueEmail("reset-reuse");
    await createUser(email);
    const token = await issueResetToken(email);

    const same = await reset(token, TEST_PASSWORD);
    expect(same.status).toBe(400);
    expect(same.body.code).toBe("PASSWORD_REUSE");

    expect((await reset(token)).status).toBe(200);
  });

  it("rejects an expired link", async () => {
    const email = uniqueEmail("reset-expired");
    const user = await createUser(email);
    const token = await issueResetToken(email);
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await reset(token);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RESET_LINK_EXPIRED");
    expect((await login(email, TEST_PASSWORD)).status).toBe(200);
  });

  it("a link only ever changes its own account", async () => {
    const alice = uniqueEmail("reset-alice");
    const bob = uniqueEmail("reset-bob");
    await createUser(alice);
    await createUser(bob);
    const aliceToken = await issueResetToken(alice);

    expect((await reset(aliceToken)).status).toBe(200);
    expect((await login(bob, TEST_PASSWORD)).status).toBe(200);
    expect((await login(bob, NEW_PASSWORD)).status).toBe(401);
  });

  it("validates token and newPassword", async () => {
    const missing = await request(app)
      .post("/api/auth/reset-password")
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.details.fieldErrors).toMatchObject({
      token: ["Token is required"],
      newPassword: ["New password is required"],
    });

    const short = await reset("some-token", "123");
    expect(short.body.details.fieldErrors.newPassword).toContain(
      "Password must be at least 6 characters",
    );
  });
});

describe("the code-based reset is gone", () => {
  it.each([
    ["/api/auth/verify-otp", { code: "123456" }],
    ["/api/auth/resend-otp", {}],
  ])("%s refuses purpose PASSWORD_RESET", async (path, extra) => {
    const res = await request(app)
      .post(path)
      .send({ email: "a@example.com", purpose: "PASSWORD_RESET", ...extra });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
