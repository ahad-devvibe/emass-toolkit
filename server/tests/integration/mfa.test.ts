import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import {
  loginEmail,
  resendOtp,
  verifyLoginOtp,
} from "../../src/services/auth/auth.service.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createUser,
  promoteToAdmin,
  promoteToDev,
  uniqueEmail,
} from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";

beforeAll(async () => {
  await resetDb();
});

async function adminUser() {
  return promoteToAdmin(await createUser(uniqueEmail("mfa-admin")));
}

async function devUser() {
  return promoteToDev(await createUser(uniqueEmail("mfa-dev")));
}

describe("MFA login (service)", () => {
  it("issues an MFA challenge for ADMIN instead of tokens", async () => {
    const user = await adminUser();

    // loginEmail uses the real emailService; under EMAIL_PROVIDER=console it
    // just logs. The important contract: no tokens are issued for ADMIN.
    const result = await loginEmail({
      email: user.email,
      password: "password123",
    });

    // loginEmail uses the real emailService; under EMAIL_PROVIDER=console it
    // just logs. The important contract: no tokens are issued for ADMIN.
    expect(result.mfaRequired).toBe(true);
    expect(result).not.toHaveProperty("accessToken");

    const otps = await prisma.otp.findMany({
      where: { userId: user.id, purpose: "MFA_LOGIN", consumedAt: null },
    });
    expect(otps).toHaveLength(1);
  });

  it("verifyLoginOtp returns tokens for the right code and consumes it", async () => {
    const sender = createMockEmailSender();
    const user = await devUser();
    await resendOtp(user.email, "MFA_LOGIN", sender);
    const code = sender.lastCode(user.email, "mfaLogin")!;

    const result = await verifyLoginOtp(user.email, code);
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user.role).toBe("DEV");

    await expect(verifyLoginOtp(user.email, code)).rejects.toMatchObject({
      code: "OTP_INVALID",
    });
  });

  it("rejects MFA verify for customers", async () => {
    const user = await createUser(uniqueEmail("mfa-customer"));
    const sender = createMockEmailSender();
    await expect(
      resendOtp(user.email, "MFA_LOGIN", sender),
    ).rejects.toMatchObject({
      code: "MFA_NOT_ALLOWED",
    });
  });

  it("rejects MFA verify for non-active users", async () => {
    const user = await createUser(uniqueEmail("mfa-pending"), {
      status: "PENDING_APPROVAL",
      role: "ADMIN",
    });
    const sender = createMockEmailSender();
    await expect(
      resendOtp(user.email, "MFA_LOGIN", sender),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_ACTIVE",
    });
  });

  it("rejects a wrong code and increments attempts", async () => {
    const user = await devUser();
    const sender = createMockEmailSender();
    await resendOtp(user.email, "MFA_LOGIN", sender);

    await expect(verifyLoginOtp(user.email, "000000")).rejects.toMatchObject({
      code: "OTP_INVALID",
    });
    const otp = await prisma.otp.findFirst({
      where: { userId: user.id, purpose: "MFA_LOGIN" },
    });
    expect(otp?.attempts).toBe(1);
  });
});

describe("MFA login (API)", () => {
  it("POST /login → mfaRequired; verify-otp → tokens", async () => {
    const user = await adminUser();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "password123" });

    expect(login.status).toBe(200);
    expect(login.body.data).toEqual({ mfaRequired: true });
    expect(login.headers["set-cookie"]).toBeUndefined();

    // pull the code the console sender logged by issuing via the service
    // with a mock, then verifying through the API
    const sender = createMockEmailSender();
    await resendOtp(user.email, "MFA_LOGIN", sender);
    const code = sender.lastCode(user.email, "mfaLogin")!;

    const verify = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: user.email, code, purpose: "MFA_LOGIN" });

    expect(verify.status).toBe(200);
    expect(verify.body.data.accessToken).toEqual(expect.any(String));
    expect(verify.body.data.user.role).toBe("ADMIN");
    expect(
      verify.headers["set-cookie"].some((c: string) =>
        c.startsWith("refreshToken="),
      ),
    ).toBe(true);
  });

  it("customers get tokens directly with no MFA step", async () => {
    const user = await createUser(uniqueEmail("mfa-direct"));

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "password123" });

    expect(login.status).toBe(200);
    expect(login.body.data.mfaRequired).toBe(false);
    expect(login.body.data.accessToken).toEqual(expect.any(String));
  });

  it("resend-otp MFA_LOGIN works over HTTP for staff", async () => {
    const user = await devUser();
    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: user.email, purpose: "MFA_LOGIN" });
    expect(res.status).toBe(200);
  });

  it("resend-otp MFA_LOGIN is forbidden for customers", async () => {
    const user = await createUser(uniqueEmail("mfa-resend-customer"));
    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: user.email, purpose: "MFA_LOGIN" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MFA_NOT_ALLOWED");
  });
});
