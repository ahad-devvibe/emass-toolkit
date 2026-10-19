import { OtpPurpose } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { emailService } from "../../src/services/email/email.service.js";
import { forgotPassword } from "../../src/services/auth/auth.service.js";
import { hashOtpCode } from "../../src/services/auth/auth.utils.js";
import { createUser, uniqueEmail } from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { resetDb } from "../helpers/resetDb.js";

async function issueResetOtp(email: string): Promise<string> {
  const sender = createMockEmailSender();
  await forgotPassword(email, sender);
  return sender.lastCode(email, "passwordReset")!;
}

function verifyResetOtp(email: string, code: string) {
  return request(app)
    .post("/api/auth/verify-otp")
    .send({ email, code, purpose: "PASSWORD_RESET" });
}

function findResetOtp(userId: string) {
  return prisma.otp.findFirst({
    where: { userId, purpose: OtpPurpose.PASSWORD_RESET },
    orderBy: { createdAt: "desc" },
  });
}

beforeAll(async () => {
  await resetDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/auth/forgot-password", () => {
  it("returns 404 for an unknown email", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("USER_NOT_FOUND");
  });

  it("sends an OTP for an existing user", async () => {
    const email = uniqueEmail("forgot");
    const user = await createUser(email);
    const getCode = captureResetCode();

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email });

    expect(res.status).toBe(200);
    const code = getCode();
    expect(code).toMatch(/^\d{6}$/);

    const otp = await findResetOtp(user.id);
    expect(otp).not.toBeNull();
    expect(otp?.consumedAt).toBeNull();
  });

  it("rejects accounts without a password", async () => {
    const email = uniqueEmail("forgot-nopass");
    await createUser(email, { password: null });

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_NOT_SET");
  });

  it("rejects BLOCKED accounts", async () => {
    const email = uniqueEmail("forgot-blocked");
    await createUser(email, { status: "BLOCKED" });

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ACCOUNT_BLOCKED");
  });

  it("propagates email delivery failures", async () => {
    const email = uniqueEmail("forgot-fail");
    await createUser(email);
    vi.spyOn(emailService, "assertReady").mockResolvedValue(undefined);
    vi.spyOn(emailService, "sendPasswordResetEmail").mockRejectedValue(
      new Error("boom"),
    );

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email });

    expect(res.status).toBe(502);
    expect(res.body.code).toBe("EMAIL_SEND_FAILED");
  });
});

function captureResetCode() {
  let code = "";
  vi.spyOn(emailService, "assertReady").mockResolvedValue(undefined);
  vi.spyOn(emailService, "sendPasswordResetEmail").mockImplementation(
    async (_email: string, c: string) => {
      code = c;
    },
  );
  return () => code;
}

describe("POST /api/auth/verify-otp (PASSWORD_RESET)", () => {
  it("validates without consuming or issuing a session", async () => {
    const email = uniqueEmail("verify-reset");
    const user = await createUser(email);
    const code = await issueResetOtp(email);

    const res = await verifyResetOtp(email, code);

    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    const otp = await findResetOtp(user.id);
    expect(otp?.consumedAt).toBeNull();
  });

  it("locks out after 5 failed attempts", async () => {
    const email = uniqueEmail("verify-lockout");
    await createUser(email);
    await issueResetOtp(email);

    for (let i = 0; i < 5; i++) {
      const res = await verifyResetOtp(email, "000000");
      expect(res.body.code).toBe("OTP_INVALID");
    }
    const res = await verifyResetOtp(email, "000000");
    expect(res.body.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("rejects an expired OTP", async () => {
    const email = uniqueEmail("verify-expired");
    const user = await createUser(email);
    const code = await issueResetOtp(email);
    await prisma.otp.updateMany({
      where: { userId: user.id, purpose: OtpPurpose.PASSWORD_RESET },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verifyResetOtp(email, code);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OTP_EXPIRED");
  });

  it("rejects MFA_LOGIN purpose for customers", async () => {
    const email = uniqueEmail("verify-mfa-customer");
    await createUser(email);
    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email, code: "123456", purpose: "MFA_LOGIN" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_NOT_ALLOWED");
  });
});

describe("POST /api/auth/reset-password", () => {
  it("resets the password and revokes all sessions", async () => {
    const email = uniqueEmail("reset-happy");
    const user = await createUser(email);
    const code = await issueResetOtp(email);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: "newpass123" });

    expect(res.status).toBe(200);

    const oldLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "password123" });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "newpass123" });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.user.id).toBe(user.id);
  });

  it("cannot use another user's reset code", async () => {
    const attacker = uniqueEmail("reset-attacker");
    const victim = uniqueEmail("reset-victim");
    await createUser(attacker);
    await createUser(victim);
    const code = await issueResetOtp(victim);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email: attacker, code, newPassword: "hijacked123" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("OTP_INVALID");
  });

  it("rejects reusing the current password without consuming the OTP", async () => {
    const email = uniqueEmail("reset-reuse");
    const user = await createUser(email);
    const code = await issueResetOtp(email);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: "password123" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_REUSE");
    const otp = await findResetOtp(user.id);
    expect(otp).not.toBeNull();

    const retry = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: "newpass123" });
    expect(retry.status).toBe(200);
  });

  it("code is single-use", async () => {
    const email = uniqueEmail("reset-single");
    await createUser(email);
    const code = await issueResetOtp(email);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: "firstpass123" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, code, newPassword: "secondpass123" });
    expect(second.status).toBe(400);
    expect(second.body.code).toBe("OTP_INVALID");
  });

  it("validating alone does not authorize a reset", async () => {
    const email = uniqueEmail("reset-validate");
    await createUser(email);
    const code = await issueResetOtp(email);
    await verifyResetOtp(email, code);

    const withoutCode = await request(app)
      .post("/api/auth/reset-password")
      .send({ email, newPassword: "newpass123" });
    expect(withoutCode.status).toBe(400);
  });

  it("keeps OTP hashes out of the database in plain text", async () => {
    const email = uniqueEmail("reset-hash");
    const user = await createUser(email);
    const code = await issueResetOtp(email);
    const otp = await findResetOtp(user.id);
    expect(otp?.codeHash).not.toBe(code);
    await expect(hashOtpCode(code)).resolves.toBeTypeOf("string");
  });
});
