import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import {
  createUser,
  promoteToAdmin,
  promoteToDev,
  uniqueEmail,
} from "../helpers/auth.js";
import { accessCookie } from "../helpers/http.js";
import { createProduct, createRelease } from "../helpers/releases.js";
import { resetDb } from "../helpers/resetDb.js";

let adminCookie: Record<string, string>;
let devId: string;

beforeAll(async () => {
  await resetDb();
  const admin = await promoteToAdmin(await createUser(uniqueEmail("admin")));
  adminCookie = { Cookie: accessCookie(admin.accessToken) };
  devId = (await promoteToDev(await createUser(uniqueEmail("dev")))).id;

  // Active: the admin and dev (staff) plus three customers
  for (const n of [1, 2, 3]) await createUser(uniqueEmail(`cust${n}`));
  // Seven pending signups, a day apart
  for (let n = 0; n < 7; n++) {
    const user = await createUser(uniqueEmail(`pending${n}`), {
      status: "PENDING_APPROVAL",
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { createdAt: new Date(Date.UTC(2026, 0, 1 + n)) },
    });
  }
  // Blocked: two competitors, one rejected, one with no recorded reason
  for (const blockReason of [
    "COMPETITOR_DOMAIN",
    "COMPETITOR_DOMAIN",
    "SIGNUP_REJECTED",
    null,
  ] as const) {
    const user = await createUser(uniqueEmail("blocked"), {
      status: "BLOCKED",
    });
    await prisma.user.update({ where: { id: user.id }, data: { blockReason } });
  }
});

const getDashboard = (headers: Record<string, string> = adminCookie) =>
  request(app).get("/api/admin/dashboard").set(headers);

describe("GET /api/admin/dashboard", () => {
  it("counts users by status, staff vs customers and block reason", async () => {
    const res = await getDashboard();

    expect(res.status).toBe(200);
    // Sign-in logs are recorded but never shown here
    expect(res.body.data).not.toHaveProperty("security");
    expect(res.body.data.users).toEqual({
      active: 5,
      activeCustomers: 3,
      activeStaff: 2,
      pendingApproval: 7,
      blockedCompetitor: 2,
      blockedRejected: 1,
    });
  });

  it("lists the oldest five pending signups with the full total", async () => {
    const { signupAlerts } = (await getDashboard()).body.data;

    expect(signupAlerts.total).toBe(7);
    expect(signupAlerts.items).toHaveLength(5);
    expect(signupAlerts.items[0].email).toMatch(/^pending0/);
    expect(signupAlerts.items[4].email).toMatch(/^pending4/);
    expect(signupAlerts.items[0]).not.toHaveProperty("password");
  });

  it("lists releases waiting for review, oldest submission first", async () => {
    const product = await createProduct();
    const versions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"];
    for (const [index, version] of versions.entries()) {
      const release = await createRelease({
        productId: product.id,
        createdById: devId,
        version,
        status: "IN_REVIEW",
      });
      await prisma.release.update({
        where: { id: release.id },
        data: { updatedAt: new Date(Date.UTC(2026, 5, 1 + index)) },
      });
    }
    await createRelease({
      productId: product.id,
      createdById: devId,
      version: "0.9.0",
      status: "DRAFT",
    });

    const body = (await getDashboard()).body.data;

    expect(body.releases.inReview).toBe(6);
    expect(body.releaseAlerts.total).toBe(6);
    expect(
      body.releaseAlerts.items.map((r: { version: string }) => r.version),
    ).toEqual(["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"]);
    expect(body.releaseAlerts.items[0]).toMatchObject({
      product: { id: product.id, name: product.name },
      createdBy: { id: devId, role: "DEV" },
    });
  });

  it("requires an admin", async () => {
    expect((await request(app).get("/api/admin/dashboard")).status).toBe(401);
    const customer = await createUser(uniqueEmail("nosy"));
    const dev = await promoteToDev(await createUser(uniqueEmail("nosy-dev")));
    for (const user of [customer, dev]) {
      const res = await getDashboard({
        Cookie: accessCookie(user.accessToken),
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
  });
});
