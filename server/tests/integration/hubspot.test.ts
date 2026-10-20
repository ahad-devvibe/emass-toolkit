import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { signup } from "../../src/services/auth/auth.service.js";
import {
  approveSignup,
  rejectSignup,
} from "../../src/services/auth/admin-signups.service.js";
import { redeemSetPasswordToken } from "../../src/services/auth/set-password.service.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  TEST_CAPTCHA_CODE,
  captchaCookieFor,
  seedDomainPoliciesForTest,
  uniqueEmail,
} from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { createMockHubspotClient } from "../helpers/hubspot.js";

function tokenFromUrl(url: string): string {
  return decodeURIComponent(url.split("token=")[1]);
}

async function signupPendingUser(
  email: string,
  overrides: Partial<{ middleName: string }> = {},
  hubspot = createMockHubspotClient(),
) {
  const sender = createMockEmailSender();
  await signup(
    {
      email,
      firstName: "Ada",
      middleName: overrides.middleName,
      lastName: "Lovelace",
      country: "GB",
      companyName: "Analytical Engines Ltd",
      jobTitle: "Engineer",
      captcha: TEST_CAPTCHA_CODE,
    },
    captchaCookieFor(TEST_CAPTCHA_CODE),
    sender,
    hubspot,
  );
  return sender;
}

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

describe("HubSpot contact lifecycle", () => {
  it("company domain: pending_password at signup, then active at set-password", async () => {
    const email = uniqueEmail("hs-custom");
    const hubspot = createMockHubspotClient();
    const sender = await signupPendingUser(
      email,
      { middleName: "Byron" },
      hubspot,
    );

    expect(hubspot.upserted).toEqual([
      {
        email,
        firstName: "Ada",
        middleName: "Byron",
        lastName: "Lovelace",
        country: "GB",
        companyName: "Analytical Engines Ltd",
        jobTitle: "Engineer",
        portalStatus: "pending_password",
      },
    ]);

    await redeemSetPasswordToken(
      tokenFromUrl(sender.lastUrl(email)!),
      "brandnew123",
      sender,
      hubspot,
    );
    expect(hubspot.upserted).toHaveLength(2);
    expect(hubspot.upserted[1]).toMatchObject({
      email,
      portalStatus: "active",
    });
  });

  it("free mail: nothing at signup, pending_password on approval, active on activation", async () => {
    const email = `hs-freemail-${randomUUID().slice(0, 8)}@gmail.com`;
    const hubspot = createMockHubspotClient();
    const sender = await signupPendingUser(email, {}, hubspot);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("PENDING_APPROVAL");
    expect(hubspot.upserted).toHaveLength(0);

    await approveSignup(user.id, sender, hubspot);
    expect(hubspot.upserted.map((c) => c.portalStatus)).toEqual([
      "pending_password",
    ]);

    await redeemSetPasswordToken(
      tokenFromUrl(sender.lastUrl(email)!),
      "brandnew123",
      sender,
      hubspot,
    );
    expect(hubspot.upserted.map((c) => c.portalStatus)).toEqual([
      "pending_password",
      "active",
    ]);
  });

  it("free mail rejected: never reaches HubSpot, row kept as BLOCKED", async () => {
    const email = `hs-reject-${randomUUID().slice(0, 8)}@gmail.com`;
    const hubspot = createMockHubspotClient();
    await signupPendingUser(email, {}, hubspot);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await rejectSignup(user.id, undefined, createMockEmailSender());

    expect(hubspot.upserted).toHaveLength(0);
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.status).toBe("BLOCKED");
  });

  it("competitor domain: 403, BLOCKED audit row, no HubSpot, idempotent", async () => {
    const email = `hs-rival-${randomUUID().slice(0, 8)}@blocked-competitor.example`;
    const hubspot = createMockHubspotClient();

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(signupPendingUser(email, {}, hubspot)).rejects.toMatchObject(
        { code: "DOMAIN_BLOCKED" },
      );
    }

    const rows = await prisma.user.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("BLOCKED");
    expect(rows[0].password).toBeNull();
    expect(hubspot.upserted).toHaveLength(0);
  });

  it("a failed set-password email rolls back the signup with no HubSpot contact", async () => {
    const email = uniqueEmail("hs-mailfail");
    const hubspot = createMockHubspotClient();
    const sender = createMockEmailSender();
    sender.sendSetPasswordEmail = async () => {
      throw new Error("smtp down");
    };

    await expect(
      signup(
        {
          email,
          firstName: "Ada",
          lastName: "Lovelace",
          country: "GB",
          companyName: "Analytical Engines Ltd",
          jobTitle: "Engineer",
          captcha: TEST_CAPTCHA_CODE,
        },
        captchaCookieFor(TEST_CAPTCHA_CODE),
        sender,
        hubspot,
      ),
    ).rejects.toThrow();

    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(hubspot.upserted).toHaveLength(0);
  });

  it("a HubSpot failure never fails signup, approval or activation", async () => {
    const failing = createMockHubspotClient();
    failing.upsertContact = async () => {
      throw new Error("hubspot down");
    };

    const email = uniqueEmail("hs-fail");
    const sender = await signupPendingUser(email, {}, failing);
    await redeemSetPasswordToken(
      tokenFromUrl(sender.lastUrl(email)!),
      "brandnew123",
      sender,
      failing,
    );
    expect((await prisma.user.findUnique({ where: { email } }))?.status).toBe(
      "ACTIVE",
    );

    const freeEmail = `hs-fail-${randomUUID().slice(0, 8)}@gmail.com`;
    const freeSender = await signupPendingUser(freeEmail, {}, failing);
    const pending = await prisma.user.findUniqueOrThrow({
      where: { email: freeEmail },
    });
    await expect(
      approveSignup(pending.id, freeSender, failing),
    ).resolves.toMatchObject({ status: "PENDING_SET_PASSWORD" });
  });

  it("token is single-use, so a second redeem cannot double-fire", async () => {
    const email = uniqueEmail("hs-single");
    const hubspot = createMockHubspotClient();
    const sender = await signupPendingUser(email, {}, hubspot);
    const token = tokenFromUrl(sender.lastUrl(email)!);

    await redeemSetPasswordToken(token, "firstpass123", sender, hubspot);
    await expect(
      redeemSetPasswordToken(token, "secondpass123", sender, hubspot),
    ).rejects.toMatchObject({ code: "SET_PASSWORD_TOKEN_INVALID" });

    expect(hubspot.upserted.map((c) => c.portalStatus)).toEqual([
      "pending_password",
      "active",
    ]);
  });
});

describe("HubSpot contact id on the user row", () => {
  it("stores the record id at signup and keeps it through activation", async () => {
    const email = uniqueEmail("hs-id");
    const contactId = `hs-${randomUUID().slice(0, 8)}`;
    const hubspot = createMockHubspotClient(contactId);
    const sender = await signupPendingUser(email, {}, hubspot);

    const afterSignup = await prisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(afterSignup.hubspotContactId).toBe(contactId);
    expect(afterSignup.hubspotSyncedAt).toBeInstanceOf(Date);

    await redeemSetPasswordToken(
      tokenFromUrl(sender.lastUrl(email)!),
      "brandnew123",
      sender,
      hubspot,
    );
    const afterActivation = await prisma.user.findUniqueOrThrow({
      where: { email },
    });
    expect(afterActivation.hubspotContactId).toBe(contactId);
    expect(afterActivation.hubspotSyncedAt!.getTime()).toBeGreaterThanOrEqual(
      afterSignup.hubspotSyncedAt!.getTime(),
    );
  });

  it("leaves both rows alone when the id already belongs to another user", async () => {
    const contactId = `hs-${randomUUID().slice(0, 8)}`;
    const first = uniqueEmail("hs-owner");
    const second = uniqueEmail("hs-dupe");
    await signupPendingUser(first, {}, createMockHubspotClient(contactId));

    await expect(
      signupPendingUser(second, {}, createMockHubspotClient(contactId)),
    ).resolves.toBeDefined();

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: first },
    });
    const dupe = await prisma.user.findUniqueOrThrow({
      where: { email: second },
    });
    expect(owner.hubspotContactId).toBe(contactId);
    expect(dupe.hubspotContactId).toBeNull();
  });

  it("keeps the id null when HubSpot fails", async () => {
    const email = uniqueEmail("hs-noid");
    const failing = createMockHubspotClient("never-stored");
    failing.upsertContact = async () => {
      throw new Error("hubspot down");
    };
    await signupPendingUser(email, {}, failing);

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.hubspotContactId).toBeNull();
    expect(row.status).toBe("PENDING_SET_PASSWORD");
  });

  it("never exposes HubSpot fields through the API", async () => {
    const email = uniqueEmail("hs-hidden");
    const sender = await signupPendingUser(
      email,
      {},
      createMockHubspotClient(`hs-${randomUUID().slice(0, 8)}`),
    );
    await redeemSetPasswordToken(
      tokenFromUrl(sender.lastUrl(email)!),
      "brandnew123",
      sender,
      createMockHubspotClient(),
    );

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "brandnew123" });
    expect(login.body.data.user).not.toHaveProperty("hubspotContactId");
    expect(login.body.data.user).not.toHaveProperty("hubspotSyncedAt");

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);
    expect(me.body.data).not.toHaveProperty("hubspotContactId");
  });
});
