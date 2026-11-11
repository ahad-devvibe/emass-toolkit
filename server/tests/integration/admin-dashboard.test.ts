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
import { resetDb } from "../helpers/resetDb.js";

let adminCookie: Record<string, string>;

beforeAll(async () => {
  await resetDb();
  const admin = await promoteToAdmin(await createUser(uniqueEmail("admin")));
  adminCookie = { Cookie: accessCookie(admin.accessToken) };
  await promoteToDev(await createUser(uniqueEmail("dev")));

  // Active: the admin and dev (staff) plus three customers
  const customers = [];
  for (const n of [1, 2, 3])
    customers.push(await createUser(uniqueEmail(`cust${n}`)));
  // Four customer downloads, one of them older than 30 days
  for (const [index, customer] of [...customers, customers[0]].entries()) {
    await prisma.download.create({
      data: {
        userId: customer.id,
        ...(index === 3 && {
          createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        }),
      },
    });
  }
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
}, 30_000); // Many sign-ups with password hashing

const getDashboard = (headers: Record<string, string> = adminCookie) =>
  request(app).get("/api/admin/dashboard").set(headers);

describe("GET /api/admin/dashboard", () => {
  it("counts customer downloads in total and over the last 30 days", async () => {
    const res = await getDashboard();

    expect(res.status).toBe(200);
    expect(res.body.data.downloads).toEqual({ total: 4, last30Days: 3 });
    expect(res.body.data).not.toHaveProperty("releases");
  });

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

  it("has nothing about release reviews", async () => {
    expect((await getDashboard()).body.data).not.toHaveProperty(
      "releaseAlerts",
    );
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
