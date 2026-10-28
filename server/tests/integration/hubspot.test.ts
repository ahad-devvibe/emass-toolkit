import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { completeSignup } from "../../src/services/auth/signup.service.js";
import {
  approveSignup,
  rejectSignup,
} from "../../src/services/auth/admin-signups.service.js";
import { resetDb } from "../helpers/resetDb.js";
import { seedDomainPoliciesForTest, uniqueEmail } from "../helpers/auth.js";
import { createMockEmailSender } from "../helpers/email.js";
import { createMockHubspotClient } from "../helpers/hubspot.js";
import { accessCookieFrom } from "../helpers/http.js";
import {
  SIGNUP_PASSWORD,
  signUpFully,
  startSignup,
} from "../helpers/signup.js";

const gmail = (prefix: string) =>
  `${prefix}-${randomUUID().slice(0, 8)}@gmail.com`;

beforeAll(async () => {
  await resetDb();
  await seedDomainPoliciesForTest();
});

describe("HubSpot contact lifecycle", () => {
  it("company domain: nothing until the signup completes, then one lead", async () => {
    const email = uniqueEmail("hs-custom");
    const hubspot = createMockHubspotClient();
    const sender = createMockEmailSender();
    // The website goes in as typed and reaches HubSpot as a full address
    const code = await startSignup(email, sender, {
      middleName: "Byron",
      website: "analytical-engines.co.uk/",
    });
    expect(hubspot.upserted).toHaveLength(0);

    await completeSignup(email, code, SIGNUP_PASSWORD, sender, hubspot);

    expect(hubspot.upserted).toEqual([
      {
        email,
        firstName: "Ada",
        middleName: "Byron",
        lastName: "Lovelace",
        country: "GB",
        companyName: "Analytical Engines Ltd",
        jobTitle: "Engineer",
        useCase: "Evaluating EMASS for a battery-powered vision sensor",
        website: "https://analytical-engines.co.uk",
      },
    ]);
  });

  it("free mail: nothing at signup, one contact on approval", async () => {
    const email = gmail("hs-freemail");
    const hubspot = createMockHubspotClient();
    await signUpFully(email, { hubspot });

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.status).toBe("PENDING_APPROVAL");
    expect(hubspot.upserted).toHaveLength(0);

    await approveSignup(user.id, createMockEmailSender(), hubspot);
    expect(hubspot.upserted.map((c) => c.email)).toEqual([email]);
  });

  it("free mail rejected: never reaches HubSpot, row kept as BLOCKED", async () => {
    const email = gmail("hs-reject");
    const hubspot = createMockHubspotClient();
    await signUpFully(email, { hubspot });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });

    await rejectSignup(user.id, undefined, createMockEmailSender());

    expect(hubspot.upserted).toHaveLength(0);
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.status).toBe("BLOCKED");
  });

  it("competitor domain: 403, BLOCKED audit row, no HubSpot, idempotent", async () => {
    const email = `hs-rival-${randomUUID().slice(0, 8)}@blocked-competitor.example`;

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(startSignup(email)).rejects.toMatchObject({
        code: "DOMAIN_BLOCKED",
      });
    }

    const rows = await prisma.user.findMany({ where: { email } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("BLOCKED");
    expect(rows[0].password).toBeNull();
  });

  it("a HubSpot failure never fails signup or approval", async () => {
    const failing = createMockHubspotClient();
    failing.upsertContact = async () => {
      throw new Error("hubspot down");
    };

    const email = uniqueEmail("hs-fail");
    const done = await signUpFully(email, { hubspot: failing });
    expect(done.user.status).toBe("ACTIVE");

    const freeEmail = gmail("hs-fail");
    await signUpFully(freeEmail, { hubspot: failing });
    const pending = await prisma.user.findUniqueOrThrow({
      where: { email: freeEmail },
    });
    await expect(
      approveSignup(pending.id, createMockEmailSender(), failing),
    ).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("a code is single-use, so a second completion cannot double-fire", async () => {
    const email = uniqueEmail("hs-single");
    const hubspot = createMockHubspotClient();
    const sender = createMockEmailSender();
    const code = await startSignup(email, sender);

    await completeSignup(email, code, "firstpass123", sender, hubspot);
    await expect(
      completeSignup(email, code, "secondpass123", sender, hubspot),
    ).rejects.toMatchObject({ code: "OTP_INVALID" });

    expect(hubspot.upserted).toHaveLength(1);
  });
});

describe("HubSpot contact id on the user row", () => {
  it("stores the record id when the account becomes active", async () => {
    const email = uniqueEmail("hs-id");
    const contactId = `hs-${randomUUID().slice(0, 8)}`;
    await signUpFully(email, { hubspot: createMockHubspotClient(contactId) });

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.hubspotContactId).toBe(contactId);
    expect(row.hubspotSyncedAt).toBeInstanceOf(Date);
  });

  it("leaves both rows alone when the id already belongs to another user", async () => {
    const contactId = `hs-${randomUUID().slice(0, 8)}`;
    const first = uniqueEmail("hs-owner");
    const second = uniqueEmail("hs-dupe");
    await signUpFully(first, { hubspot: createMockHubspotClient(contactId) });

    await expect(
      signUpFully(second, { hubspot: createMockHubspotClient(contactId) }),
    ).resolves.toBeDefined();

    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: first },
    });
    const dupe = await prisma.user.findUniqueOrThrow({
      where: { email: second },
    });
    expect(owner.hubspotContactId).toBe(contactId);
    expect(dupe.hubspotContactId).toBeNull();
    expect(dupe.status).toBe("ACTIVE");
  });

  it("keeps the id null when HubSpot fails", async () => {
    const email = uniqueEmail("hs-noid");
    const failing = createMockHubspotClient("never-stored");
    failing.upsertContact = async () => {
      throw new Error("hubspot down");
    };
    await signUpFully(email, { hubspot: failing });

    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.hubspotContactId).toBeNull();
    expect(row.status).toBe("ACTIVE");
  });

  it("never exposes HubSpot fields through the API", async () => {
    const email = uniqueEmail("hs-hidden");
    await signUpFully(email, {
      hubspot: createMockHubspotClient(`hs-${randomUUID().slice(0, 8)}`),
    });

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email, password: SIGNUP_PASSWORD });
    expect(login.body.data.user).not.toHaveProperty("hubspotContactId");
    expect(login.body.data.user).not.toHaveProperty("hubspotSyncedAt");

    const me = await request(app)
      .get("/api/auth/me")
      .set("Cookie", accessCookieFrom(login.headers));
    expect(me.body.data).not.toHaveProperty("hubspotContactId");
  });
});
