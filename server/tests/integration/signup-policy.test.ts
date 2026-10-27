import { UserStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import {
  completeSignup,
  signup,
} from "../../src/services/auth/signup.service.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  TEST_CAPTCHA_CODE,
  captchaCookieFor,
  seedDomainPoliciesForTest,
  uniqueEmail,
} from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import {
  SIGNUP_PASSWORD,
  signUpFully,
  signupInput,
  startSignup,
} from "../helpers/signup.js";
import { classifySignupEmail } from "../../src/services/auth/domains.service.js";

const captchaCookie = () => captchaCookieFor(TEST_CAPTCHA_CODE);
const gmail = (prefix: string) =>
  `${uniqueEmail(prefix).split("@")[0]}@gmail.com`;

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("classifySignupEmail", () => {
  it("classifies seeded competitor and free-mail domains", async () => {
    expect(await classifySignupEmail("x@blocked-competitor.example")).toBe(
      "COMPETITOR",
    );
    expect(await classifySignupEmail("x@gmail.com")).toBe("FREE_MAIL");
    expect(await classifySignupEmail("x@customer-corp.com")).toBe("CUSTOM");
  });
});

describe("signup step 1: the form", () => {
  it("blocks competitor domains, keeping a BLOCKED audit row and sending nothing", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("blocked").replace(
      /@.*$/,
      "@blocked-competitor.example",
    );

    await expect(
      signup(signupInput(email), captchaCookie(), sender),
    ).rejects.toMatchObject({ code: "DOMAIN_BLOCKED" });

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.status).toBe("BLOCKED");
    expect(user?.blockReason).toBe("COMPETITOR_DOMAIN");
    expect(user?.password).toBeNull();
    expect(sender.sent).toHaveLength(0);
  });

  it.each([
    ["a company address", () => uniqueEmail("corp")],
    ["a free-mail address", () => gmail("free")],
  ])(
    "emails a code for %s and creates an unfinished signup",
    async (_, make) => {
      const sender = createMockEmailSender();
      const email = make();

      const result = await signup(signupInput(email), captchaCookie(), sender);

      expect(result).toEqual({ email });
      const row = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(row.status).toBe(UserStatus.PENDING_SET_PASSWORD);
      expect(row.password).toBeNull();
      expect(row.emailVerified).toBe(false);
      expect(row.country).toBe("GB");
      expect(row.middleName).toBeNull();
      expect(sender.sent.map((e) => e.kind)).toEqual(["otp"]);
      expect(sender.lastCode(email)).toMatch(/^\d{6}$/);
    },
  );

  it("stores middleName when provided", async () => {
    const email = uniqueEmail("middle");
    await startSignup(email, createMockEmailSender(), { middleName: "Byron" });
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.middleName).toBe("Byron");
  });

  // Country is validated by the route's Zod schema, so this goes through HTTP
  it("rejects a malformed country code", async () => {
    const email = uniqueEmail("country");
    const res = await request(app)
      .post("/api/auth/signup")
      .set("Cookie", [`captcha=${captchaCookie()}`])
      .send({ ...signupInput(email), country: "USA" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.fieldErrors.country).toContain(
      "Country must be a valid ISO 3166-1 alpha-2 code",
    );
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("deletes a new user when the code email fails", async () => {
    const sender = createMockEmailSender();
    sender.sendOtpEmail = async () => {
      throw new ApiError(502, "Unable to send email", "EMAIL_SEND_FAILED");
    };
    const email = uniqueEmail("sendfail");

    await expect(
      signup(signupInput(email), captchaCookie(), sender),
    ).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("keeps a resumed signup when the new code email fails", async () => {
    const email = uniqueEmail("resume-sendfail");
    await startSignup(email);
    const sender = createMockEmailSender();
    sender.sendOtpEmail = async () => {
      throw new ApiError(502, "Unable to send email", "EMAIL_SEND_FAILED");
    };

    await expect(
      signup(signupInput(email), captchaCookie(), sender),
    ).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });

    expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
  });
});

describe("signup step 3: where each domain ends up", () => {
  it("a company address is ACTIVE and gets tokens", async () => {
    const email = uniqueEmail("corp-done");
    const result = await signUpFully(email);

    expect(result.user.status).toBe("ACTIVE");
    expect(result.user).not.toHaveProperty("password");
    expect(result.tokens?.accessToken).toBeTruthy();
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.status).toBe(UserStatus.ACTIVE);
    expect(row.emailVerified).toBe(true);
    expect(row.password).not.toBeNull();
  });

  it("a free-mail address waits for approval, without tokens", async () => {
    const email = gmail("free-done");
    const result = await signUpFully(email);

    expect(result.user.status).toBe("PENDING_APPROVAL");
    expect(result.tokens).toBeNull();
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.status).toBe(UserStatus.PENDING_APPROVAL);
    expect(row.emailVerified).toBe(true);
  });

  it("re-checks the domain, so a domain blocked mid-signup stays blocked", async () => {
    const domain = `turned-rival-${Date.now()}.example`;
    const email = `someone@${domain}`;
    const code = await startSignup(email);
    await prisma.emailDomainPolicy.create({
      data: { domain, kind: "COMPETITOR" },
    });

    await expect(
      completeSignup(email, code, SIGNUP_PASSWORD, createMockEmailSender()),
    ).rejects.toMatchObject({ code: "DOMAIN_BLOCKED" });
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.password).toBeNull();
  });
});
