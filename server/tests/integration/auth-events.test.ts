import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resendOtp } from "../../src/services/auth/auth.service.js";
import { requestPasswordReset } from "../../src/services/auth/password-reset.service.js";
import {
  TEST_PASSWORD,
  createUser,
  promoteToAdmin,
  uniqueEmail,
} from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { resetDb } from "../helpers/resetDb.js";

beforeAll(resetDb);

afterEach(() => {
  vi.restoreAllMocks();
});

function login(email: string, password = TEST_PASSWORD) {
  return request(app)
    .post("/api/auth/login")
    .set("User-Agent", "vitest-agent")
    .send({ email, password });
}

const eventsFor = (email: string) =>
  prisma.authEvent.findMany({
    where: { email },
    orderBy: { createdAt: "asc" },
  });

describe("sign-in audit trail", () => {
  it("records a customer sign-in with the user, IP and user agent", async () => {
    const user = await createUser(uniqueEmail("ok"));

    expect((await login(user.email)).status).toBe(200);

    const [event] = await eventsFor(user.email);
    expect(event).toMatchObject({
      type: "SIGN_IN_SUCCEEDED",
      userId: user.id,
      code: null,
      userAgent: "vitest-agent",
    });
    expect(event.ip).toBeTruthy();
  });

  it("records refusals with their code, including unknown emails", async () => {
    const user = await createUser(uniqueEmail("wrong"));
    const blocked = await createUser(uniqueEmail("blocked"), {
      status: "BLOCKED",
    });
    const unknown = uniqueEmail("nobody");

    await login(user.email, "not-the-password");
    await login(blocked.email);
    await login(unknown);

    expect(await eventsFor(user.email)).toMatchObject([
      { type: "SIGN_IN_FAILED", code: "INVALID_CREDENTIALS", userId: user.id },
    ]);
    expect(await eventsFor(blocked.email)).toMatchObject([
      { type: "SIGN_IN_FAILED", code: "ACCOUNT_BLOCKED", userId: blocked.id },
    ]);
    expect(await eventsFor(unknown)).toMatchObject([
      { type: "SIGN_IN_FAILED", code: "INVALID_CREDENTIALS", userId: null },
    ]);
  });

  it("signs staff in at the MFA step, not the password step", async () => {
    const admin = await promoteToAdmin(await createUser(uniqueEmail("mfa")));

    expect((await login(admin.email)).body.data).toEqual({ mfaRequired: true });
    expect(await eventsFor(admin.email)).toEqual([]);

    const bad = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: admin.email, code: "000000", purpose: "MFA_LOGIN" });
    expect(bad.status).toBe(400);

    const sender = createMockEmailSender();
    await resendOtp(admin.email, "MFA_LOGIN", sender);
    const code = sender.lastCode(admin.email, "mfaLogin")!;
    const ok = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: admin.email, code, purpose: "MFA_LOGIN" });
    expect(ok.status).toBe(200);

    expect(await eventsFor(admin.email)).toMatchObject([
      { type: "SIGN_IN_FAILED", code: bad.body.code },
      { type: "SIGN_IN_SUCCEEDED", userId: admin.id },
    ]);
  });

  it("records a completed password reset", async () => {
    const user = await createUser(uniqueEmail("reset"));
    const sender = createMockEmailSender();
    await requestPasswordReset(user.email, sender);
    const token = new URL(sender.lastUrl(user.email)!).searchParams.get(
      "token",
    );

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: "newpass123" });

    expect(res.status).toBe(200);
    expect(await eventsFor(user.email)).toMatchObject([
      { type: "PASSWORD_RESET", userId: user.id },
    ]);
  });

  it("never fails a sign-in when the audit write fails", async () => {
    const user = await createUser(uniqueEmail("audit-down"));
    vi.spyOn(prisma.authEvent, "create").mockRejectedValue(
      new Error("db down"),
    );

    expect((await login(user.email)).status).toBe(200);
    expect((await login(user.email, "nope")).body.code).toBe(
      "INVALID_CREDENTIALS",
    );
  });
});
