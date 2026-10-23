// TODO(auth-otp-signup): covers the set-password service, unused since OTP
// signup; remove together with it.
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { env } from "../../src/configs/env.js";
import {
  buildSetPasswordUrl,
  getSetPasswordInvite,
  issueSetPasswordToken,
  redeemSetPasswordToken,
  resendSetPasswordEmail,
  sendDueSetPasswordReminders,
} from "../../src/services/auth/set-password.service.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createUser,
  seedDomainPoliciesForTest,
  uniqueEmail,
} from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";

const TOKEN_TTL_MS = env.SET_PASSWORD_TTL_HOURS * 60 * 60 * 1000;

// What the old signup left behind: no password, and a set-password link
async function signupPendingUser(
  email: string,
  sender = createMockEmailSender(),
) {
  const user = await createUser(email, {
    firstName: "Ada",
    status: "PENDING_SET_PASSWORD",
    password: null,
    emailVerified: false,
  });
  await issueSetPasswordToken(user.id, sender);
  return sender;
}

function tokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("token=")[1]);
}

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

describe("buildSetPasswordUrl", () => {
  it("joins APP_BASE_URL and the token", () => {
    expect(buildSetPasswordUrl("abc")).toBe(
      `${env.APP_BASE_URL.replace(/\/+$/, "")}/set-password?token=abc`,
    );
  });
});

describe("set-password invite lifecycle", () => {
  it("redeems a valid token: password set, ACTIVE, token consumed", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("redeem");
    await signupPendingUser(email, sender);

    const url = sender.lastUrl(email)!;
    const invite = await getSetPasswordInvite(tokenFromUrl(url));
    expect(invite.email).toBe(email);
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now());

    await redeemSetPasswordToken(tokenFromUrl(url), "brandnew123", sender);

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.status).toBe("ACTIVE");
    expect(sender.sent.at(-1)).toMatchObject({
      kind: "welcome",
      email,
      url: "http://localhost:5173/catalog",
    });
    expect(row?.emailVerified).toBe(true);
    expect(row?.password).not.toBeNull();

    const tokens = await prisma.setPasswordToken.findMany({
      where: { userId: row!.id },
    });
    expect(tokens.every((t) => t.consumedAt !== null)).toBe(true);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "brandnew123" });
    expect(login.status).toBe(200);
  });

  it("activates the account even when the welcome email fails", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("welcome-fail");
    await signupPendingUser(email, sender);
    sender.sendWelcomeEmail = async () => {
      throw new Error("smtp down");
    };

    await redeemSetPasswordToken(
      tokenFromUrl(sender.lastUrl(email)!),
      "brandnew123",
      sender,
    );

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.status).toBe("ACTIVE");
  });

  it("rejects an unknown token", async () => {
    await expect(getSetPasswordInvite("bogus")).rejects.toMatchObject({
      code: "SET_PASSWORD_TOKEN_INVALID",
    });
    await expect(
      redeemSetPasswordToken("bogus", "password123"),
    ).rejects.toMatchObject({ code: "SET_PASSWORD_TOKEN_INVALID" });
  });

  it("rejects an expired token", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("expired");
    await signupPendingUser(email, sender);
    const token = tokenFromUrl(sender.lastUrl(email)!);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.setPasswordToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(getSetPasswordInvite(token)).rejects.toMatchObject({
      code: "SET_PASSWORD_EXPIRED",
    });
    await expect(
      redeemSetPasswordToken(token, "password123"),
    ).rejects.toMatchObject({ code: "SET_PASSWORD_EXPIRED" });
  });

  it("token is single-use", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("singleuse");
    await signupPendingUser(email, sender);
    const token = tokenFromUrl(sender.lastUrl(email)!);

    await redeemSetPasswordToken(token, "firstpass123");
    await expect(
      redeemSetPasswordToken(token, "secondpass123"),
    ).rejects.toMatchObject({ code: "SET_PASSWORD_TOKEN_INVALID" });
  });

  it("resend issues a fresh token and invalidates the old link", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("resend");
    await signupPendingUser(email, sender);
    const oldToken = tokenFromUrl(sender.lastUrl(email)!);

    await resendSetPasswordEmail(email, sender);
    const newToken = tokenFromUrl(sender.lastUrl(email)!);
    expect(newToken).not.toBe(oldToken);

    await expect(getSetPasswordInvite(oldToken)).rejects.toMatchObject({
      code: "SET_PASSWORD_TOKEN_INVALID",
    });
    const invite = await getSetPasswordInvite(newToken);
    expect(invite.email).toBe(email);
  });

  it("resend requires a PENDING_SET_PASSWORD account", async () => {
    const sender = createMockEmailSender();
    await createUser(uniqueEmail("resend-active"));
    await expect(
      resendSetPasswordEmail(uniqueEmail("resend-active"), sender),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
  });
});

describe("24h reminder sweep", () => {
  it("sends exactly one reminder for tokens older than the reminder window", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("remind");
    await signupPendingUser(email, sender);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    // too new — sweep must skip
    expect(await sendDueSetPasswordReminders(sender)).toBe(0);

    await prisma.setPasswordToken.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    const reminders = sender.sent.filter(
      (s) => s.kind === "setPasswordReminder",
    );
    expect(reminders).toHaveLength(0);

    const sent = await sendDueSetPasswordReminders(sender);
    expect(sent).toBe(1);
    const afterFirst = sender.sent.filter(
      (s) => s.kind === "setPasswordReminder",
    );
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].url).toMatch(/\/set-password\?token=/);
    expect(afterFirst[0].hoursLeft).toBeGreaterThan(0);

    // reminderSentAt set + original expiry preserved
    const token = await prisma.setPasswordToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(token.reminderSentAt).not.toBeNull();
    expect(token.expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + TOKEN_TTL_MS + 60_000,
    );

    // second sweep sends nothing more
    expect(await sendDueSetPasswordReminders(sender)).toBe(0);
  });

  it("skips expired tokens", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("remind-expired");
    await signupPendingUser(email, sender);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.setPasswordToken.updateMany({
      where: { userId: user.id },
      data: {
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    expect(await sendDueSetPasswordReminders(sender)).toBe(0);
  });
});

describe("set-password routes", () => {
  it("are no longer mounted", async () => {
    const calls = [
      request(app).get("/api/auth/set-password/some-token"),
      request(app)
        .post("/api/auth/set-password")
        .send({ token: "t", password: "brandnew123" }),
      request(app)
        .post("/api/auth/resend-set-password")
        .send({ email: "ghost@example.com" }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(404);
    }
  });
});

describe("issueSetPasswordToken", () => {
  it("replaces previous tokens for the same user", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("replace");
    await signupPendingUser(email, sender);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await issueSetPasswordToken(user.id, sender);
    await issueSetPasswordToken(user.id, sender);

    const tokens = await prisma.setPasswordToken.findMany({
      where: { userId: user.id },
    });
    expect(tokens).toHaveLength(1);
  });
});
