import { OtpPurpose } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { emailService } from "../../src/services/email/email.service.js";
import { hubspotService } from "../../src/services/hubspot/hubspot.service.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  TEST_CAPTCHA_CODE,
  captchaCookieFor,
  createUser,
  seedDomainPoliciesForTest,
  uniqueEmail,
} from "../helpers/auth.js";
import { SIGNUP_PASSWORD, signupInput } from "../helpers/signup.js";
import { accessCookieFrom, setCookies } from "../helpers/http.js";

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const gmail = (prefix: string) =>
  `${uniqueEmail(prefix).split("@")[0]}@gmail.com`;

/** Records every email the real sender would send, keyed by kind. */
function captureEmails() {
  const sent: { kind: string; email: string; code?: string }[] = [];
  vi.spyOn(emailService, "assertReady").mockResolvedValue(undefined);
  vi.spyOn(emailService, "sendOtpEmail").mockImplementation(
    async (email, code) => {
      sent.push({ kind: "otp", email, code });
    },
  );
  vi.spyOn(emailService, "sendWelcomeEmail").mockImplementation(
    async (email) => {
      sent.push({ kind: "welcome", email });
    },
  );
  vi.spyOn(emailService, "sendPendingApprovalEmail").mockImplementation(
    async (email) => {
      sent.push({ kind: "pendingApproval", email });
    },
  );
  const upsert = vi
    .spyOn(hubspotService, "upsertContact")
    .mockResolvedValue(null);
  const lastCode = (email: string) =>
    sent.filter((e) => e.kind === "otp" && e.email === email).at(-1)?.code ??
    "";
  return { sent, lastCode, upsert };
}

const postSignup = (email: string, overrides = {}) =>
  request(app)
    .post("/api/auth/signup")
    .set("Cookie", [`captcha=${captchaCookieFor(TEST_CAPTCHA_CODE)}`])
    .send({ ...signupInput(email), ...overrides });

const verify = (email: string, code: string) =>
  request(app).post("/api/auth/signup/verify").send({ email, code });

const complete = (email: string, code: string, password = SIGNUP_PASSWORD) =>
  request(app)
    .post("/api/auth/signup/complete")
    .send({ email, code, password });

const wrongCode = (code: string) =>
  String((Number(code) + 1) % 1_000_000).padStart(6, "0");

describe("POST /api/auth/signup", () => {
  it("stores an optional website as a full URL, and refuses one that isn't", async () => {
    captureEmails();
    const email = uniqueEmail("website");

    expect((await postSignup(email, { website: "acme.com/" })).status).toBe(
      201,
    );
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.website).toBe("https://acme.com");

    const bare = uniqueEmail("nosite");
    expect((await postSignup(bare)).status).toBe(201);
    expect(
      (await prisma.user.findUnique({ where: { email: bare } }))?.website,
    ).toBeNull();

    const bad = await postSignup(uniqueEmail("badsite"), {
      website: "not a site",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details.fieldErrors.website).toEqual([
      "Enter a website like yourcompany.com",
    ]);
  });

  it("emails a code and answers with the email only, no HubSpot", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("start");

    const res = await postSignup(email.toUpperCase());

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ email });
    expect(res.body.message).toBe("Verification code sent to your email");
    expect(mail.sent.map((e) => e.kind)).toEqual(["otp"]);
    expect(mail.lastCode(email)).toMatch(/^\d{6}$/);
    expect(mail.upsert).not.toHaveBeenCalled();
    // The captcha is single-use
    expect(setCookies(res.headers).some((c) => c.startsWith("captcha=;"))).toBe(
      true,
    );
  });

  it("resumes an unfinished signup: new details, new code, old code dead", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("resume");
    await postSignup(email);
    const first = mail.lastCode(email);

    const res = await postSignup(email, {
      jobTitle: "CTO",
      useCase: "Now prototyping a wearable",
    });

    expect(res.status).toBe(201);
    const second = mail.lastCode(email);
    expect(second).not.toBe(first);
    const rows = await prisma.user.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(rows[0].jobTitle).toBe("CTO");
    expect(rows[0].useCase).toBe("Now prototyping a wearable");
    if (first !== second) {
      expect((await verify(email, first)).body.code).toBe("OTP_INVALID");
    }
    expect((await verify(email, second)).status).toBe(200);
  });

  it.each(["ACTIVE", "PENDING_APPROVAL", "BLOCKED"] as const)(
    "refuses an email that already has a %s account",
    async (status) => {
      const mail = captureEmails();
      // Lowercase: signup normalizes the email, but createUser stores it as given
      const email = uniqueEmail(`taken-${status.toLowerCase()}`);
      await createUser(email, { status });

      const res = await postSignup(email);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe("EMAIL_TAKEN");
      expect(mail.sent).toHaveLength(0);
    },
  );

  it("refuses a competitor domain", async () => {
    captureEmails();
    const res = await postSignup("someone@blocked-competitor.example");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("DOMAIN_BLOCKED");
  });
});

describe("POST /api/auth/signup/verify", () => {
  it("accepts the right code without using it up", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("verify-ok");
    await postSignup(email);
    const code = mail.lastCode(email);

    const res = await verify(email, code);
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect((await verify(email, code)).status).toBe(200);
    expect((await complete(email, code)).status).toBe(200);
  });

  it("refuses a wrong code and locks after five attempts", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("verify-wrong");
    await postSignup(email);
    const code = mail.lastCode(email);

    for (let i = 0; i < 5; i++) {
      const res = await verify(email, wrongCode(code));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("OTP_INVALID");
    }
    const locked = await verify(email, code);
    expect(locked.body.code).toBe("OTP_ATTEMPTS_EXCEEDED");
  });

  it("refuses an expired code", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("verify-expired");
    await postSignup(email);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.otp.updateMany({
      where: { userId: user.id, purpose: OtpPurpose.SIGNUP_VERIFY },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await verify(email, mail.lastCode(email));
    expect(res.body.code).toBe("OTP_EXPIRED");
  });

  it("gives unknown and finished accounts the same OTP_INVALID", async () => {
    const active = uniqueEmail("verify-active");
    await createUser(active);
    for (const email of [uniqueEmail("verify-ghost"), active]) {
      const res = await verify(email, "123456");
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("OTP_INVALID");
    }
  });

  it("validates the body", async () => {
    const res = await request(app).post("/api/auth/signup/verify").send({});
    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors).toEqual({
      email: ["Email is required"],
      code: ["OTP code is required"],
    });
  });
});

describe("POST /api/auth/signup/complete", () => {
  it("company address: ACTIVE, signed in, welcome email, HubSpot contact", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("complete-corp");
    await postSignup(email);

    const res = await complete(email, mail.lastCode(email));

    expect(res.status).toBe(200);
    expect(res.body.data.signedIn).toBe(true);
    expect(res.body.data.user).toMatchObject({ email, status: "ACTIVE" });
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(res.body.data).not.toHaveProperty("accessToken");
    expect(mail.sent.map((e) => e.kind)).toEqual(["otp", "welcome"]);
    expect(mail.upsert).toHaveBeenCalledTimes(1);
    expect(mail.upsert.mock.calls[0][0]).toMatchObject({ email });

    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", accessCookieFrom(res.headers));
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(email);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: SIGNUP_PASSWORD });
    expect(login.status).toBe(200);
  });

  it("free mail: PENDING_APPROVAL, not signed in, no HubSpot, login refused", async () => {
    const mail = captureEmails();
    const email = gmail("complete-free");
    await postSignup(email);

    const res = await complete(email, mail.lastCode(email));

    expect(res.status).toBe(200);
    expect(res.body.data.signedIn).toBe(false);
    expect(res.body.data.user.status).toBe("PENDING_APPROVAL");
    expect(res.headers["set-cookie"]).toBeUndefined();
    expect(mail.sent.map((e) => e.kind)).toEqual(["otp", "pendingApproval"]);
    expect(mail.upsert).not.toHaveBeenCalled();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: SIGNUP_PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe("ACCOUNT_PENDING_APPROVAL");
  });

  it("a used code can't finish it again or change the password", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("complete-twice");
    await postSignup(email);
    const code = mail.lastCode(email);

    expect((await complete(email, code)).status).toBe(200);
    const again = await complete(email, code, "another123");
    expect(again.status).toBe(400);
    expect(again.body.code).toBe("OTP_INVALID");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: SIGNUP_PASSWORD });
    expect(login.status).toBe(200);
  });

  it("a wrong code leaves the signup unfinished", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("complete-wrong");
    await postSignup(email);

    const res = await complete(email, wrongCode(mail.lastCode(email)));

    expect(res.body.code).toBe("OTP_INVALID");
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.password).toBeNull();
    expect(row.status).toBe("PENDING_SET_PASSWORD");
  });

  it("can't take over an existing account", async () => {
    const email = uniqueEmail("complete-takeover");
    await createUser(email);
    const res = await complete(email, "123456", "attacker123");
    expect(res.body.code).toBe("OTP_INVALID");
  });

  it("validates the password with a plain label", async () => {
    const res = await request(app)
      .post("/api/auth/signup/complete")
      .send({ email: "a@b.com", code: "123456" });
    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors.password).toEqual([
      "Password is required",
    ]);
  });
});

describe("POST /api/auth/resend-otp (SIGNUP_VERIFY)", () => {
  it("sends a new code for an unfinished signup", async () => {
    const mail = captureEmails();
    const email = uniqueEmail("resend");
    await postSignup(email);

    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email, purpose: "SIGNUP_VERIFY" });

    expect(res.status).toBe(200);
    expect(mail.sent.filter((e) => e.kind === "otp")).toHaveLength(2);
    expect((await verify(email, mail.lastCode(email))).status).toBe(200);
  });

  it("answers the same for unknown and finished accounts, sending nothing", async () => {
    const mail = captureEmails();
    const active = uniqueEmail("resend-active");
    await createUser(active);

    for (const email of [uniqueEmail("resend-ghost"), active]) {
      const res = await request(app)
        .post("/api/auth/resend-otp")
        .send({ email, purpose: "SIGNUP_VERIFY" });
      expect(res.status).toBe(200);
    }
    expect(mail.sent).toHaveLength(0);
  });
});
