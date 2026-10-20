import { UserStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/configs/prisma.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { signup } from "../../src/services/auth/auth.service.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  TEST_CAPTCHA_CODE,
  captchaCookieFor,
  seedDomainPoliciesForTest,
  uniqueEmail,
} from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { classifySignupEmail } from "../../src/services/auth/domains.service.js";

const signupInput = (email: string) => ({
  email,
  firstName: "Ada",
  lastName: "Lovelace",
  country: "GB",
  companyName: "Analytical Engines",
  jobTitle: "Engineer",
  captcha: TEST_CAPTCHA_CODE,
});

const captchaCookie = () => captchaCookieFor(TEST_CAPTCHA_CODE);

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

describe("signup domain routing", () => {
  it("blocks competitor domains, keeping a BLOCKED audit row and sending nothing", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("blocked");
    const fullEmail = email.replace(/@.*$/, "@blocked-competitor.example");

    await expect(
      signup(signupInput(fullEmail), captchaCookie(), sender),
    ).rejects.toMatchObject({ code: "DOMAIN_BLOCKED" });

    const user = await prisma.user.findUnique({ where: { email: fullEmail } });
    expect(user?.status).toBe("BLOCKED");
    expect(user?.password).toBeNull();
    expect(sender.sent).toHaveLength(0);
  });

  it("queues free-mail signups as PENDING_APPROVAL and emails a notice", async () => {
    const sender = createMockEmailSender();
    const email = `free-${uniqueEmail("x").split("@")[0]}@gmail.com`;

    const result = await signup(signupInput(email), captchaCookie(), sender);

    expect(result.status).toBe("PENDING_APPROVAL");
    expect(result).not.toHaveProperty("password");
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.status).toBe(UserStatus.PENDING_APPROVAL);
    expect(row?.password).toBeNull();
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].kind).toBe("pendingApproval");
    expect(sender.sent[0].firstName).toBe("Ada");
  });

  it("activates custom-domain signups for set-password and emails the link", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("corp");

    const result = await signup(signupInput(email), captchaCookie(), sender);

    expect(result.status).toBe("PENDING_SET_PASSWORD");
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.status).toBe(UserStatus.PENDING_SET_PASSWORD);
    expect(row?.country).toBe("GB");
    expect(row?.middleName).toBeNull();

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].kind).toBe("setPassword");
    expect(sender.sent[0].url).toMatch(/\/set-password\?token=/);
    expect(sender.sent[0].expiresInHours).toBe(48);

    const tokens = await prisma.setPasswordToken.findMany({
      where: { userId: row!.id },
    });
    expect(tokens).toHaveLength(1);
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(tokens[0].reminderSentAt).toBeNull();
  });

  it("stores middleName when provided", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("middle");
    await signup(
      { ...signupInput(email), middleName: "Byron" },
      captchaCookie(),
      sender,
    );
    const row = await prisma.user.findUnique({ where: { email } });
    expect(row?.middleName).toBe("Byron");
  });

  it("rejects duplicate signups with EMAIL_TAKEN", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("dupe");
    await signup(signupInput(email), captchaCookie(), sender);

    await expect(
      signup(signupInput(email), captchaCookie(), sender),
    ).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("rejects a malformed country code", async () => {
    const sender = createMockEmailSender();
    const email = uniqueEmail("country");
    await expect(
      signup(
        { ...signupInput(email), country: "USA" },
        captchaCookie(),
        sender,
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("compensates by deleting the user when the email send fails", async () => {
    const sender = createMockEmailSender();
    sender.sendSetPasswordEmail = async () => {
      throw new ApiError(
        502,
        "Unable to send set-password email",
        "EMAIL_SEND_FAILED",
      );
    };
    const email = uniqueEmail("sendfail");

    await expect(
      signup(signupInput(email), captchaCookie(), sender),
    ).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });

    const row = await prisma.user.findUnique({ where: { email } });
    expect(row).toBeNull();
  });
});
