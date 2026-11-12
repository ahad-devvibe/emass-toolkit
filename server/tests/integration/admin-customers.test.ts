import type { Prisma } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import { uniqueEmail } from "../helpers/auth.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  type StaffUser,
} from "../helpers/releases.js";

let admin: StaffUser;
let dev: StaffUser;
let customer: StaffUser;

// Customers made straight in the DB (no password hashing), oldest first
let base = Date.parse("2026-01-01T00:00:00Z");
async function customerRow(data: Partial<Prisma.UserCreateInput> = {}) {
  base += 60_000;
  return prisma.user.create({
    data: {
      email: uniqueEmail("cust"),
      firstName: "Casey",
      lastName: "Customer",
      country: "US",
      companyName: "Example Co",
      jobTitle: "Engineer",
      status: "ACTIVE",
      createdAt: new Date(base),
      ...data,
    },
  });
}

const list = (query = "", user: StaffUser = admin) =>
  request(app).get(`/api/admin/customers${query}`).set(user.cookie);

type Row = { id: string };
const ids = (body: { data: { customers: Row[] } }) =>
  body.data.customers.map((row) => row.id);

beforeAll(async () => {
  await resetDb();
  admin = await createAdmin();
  dev = await createDev();
  customer = await createCustomer();
});

describe("GET /api/admin/customers", () => {
  it("lists only customers, newest first, with their download details", async () => {
    const older = await customerRow({ firstName: "Older" });
    const newer = await customerRow({
      firstName: "Newer",
      downloadCount: 3,
      firstDownloadAt: new Date("2026-02-01T00:00:00Z"),
      firstDownloadLabel: "Core v1.0.0 — sdk.zip",
      lastDownloadAt: new Date("2026-03-01T00:00:00Z"),
      lastDownloadLabel: "Core v1.1.0 — sdk.zip",
      useCase: "Robotics",
      website: "https://example.com",
    });

    const res = await list("?limit=50");

    expect(res.status).toBe(200);
    const listed = ids(res.body);
    expect(listed).not.toContain(admin.id);
    expect(listed).not.toContain(dev.id);
    expect(listed.indexOf(newer.id)).toBeLessThan(listed.indexOf(older.id));
    expect(
      res.body.data.customers.find((row: Row) => row.id === newer.id),
    ).toMatchObject({
      firstName: "Newer",
      downloadCount: 3,
      firstDownloadLabel: "Core v1.0.0 — sdk.zip",
      lastDownloadAt: "2026-03-01T00:00:00.000Z",
      lastDownloadLabel: "Core v1.1.0 — sdk.zip",
      useCase: "Robotics",
      website: "https://example.com",
    });
  });

  it("never sends passwords, tokens or HubSpot fields", async () => {
    const res = await list("?limit=50");
    const row = res.body.data.customers[0];
    for (const key of [
      "password",
      "role",
      "hubspotContactId",
      "hubspotSyncedAt",
      "hubspotSyncedDownloads",
      "hubspotNoteSentAt",
    ]) {
      expect(row).not.toHaveProperty(key);
    }
  });

  it("searches names, email and company; every word must match", async () => {
    const target = await customerRow({
      firstName: "Zelda",
      lastName: "Quartz",
      companyName: "Orbital Widgets",
    });
    await customerRow({ firstName: "Zelda", companyName: "Other Inc" });

    for (const q of ["zelda quartz", "orbital", "ORBITAL zelda"]) {
      const res = await list(`?q=${encodeURIComponent(q)}`);
      expect(ids(res.body)).toEqual([target.id]);
      expect(res.body.data.total).toBe(1);
    }
    const byEmail = await list(`?q=${encodeURIComponent(target.email)}`);
    expect(ids(byEmail.body)).toEqual([target.id]);
  });

  it("filters by status and by whether they have downloaded", async () => {
    const blocked = await customerRow({
      status: "BLOCKED",
      blockReason: "SIGNUP_REJECTED",
      companyName: "Filter Co",
    });
    const downloaded = await customerRow({
      downloadCount: 1,
      companyName: "Filter Co",
    });
    const never = await customerRow({ companyName: "Filter Co" });

    const blockedRes = await list("?q=filter&status=BLOCKED");
    expect(ids(blockedRes.body)).toEqual([blocked.id]);
    expect(blockedRes.body.data.customers[0].blockReason).toBe(
      "SIGNUP_REJECTED",
    );

    const any = await list("?q=filter&downloads=any");
    expect(ids(any.body)).toEqual([downloaded.id]);

    const none = await list("?q=filter&downloads=none&status=ACTIVE");
    expect(ids(none.body)).toEqual([never.id]);
  });

  it("never lists an unfinished sign-up", async () => {
    const unfinished = await customerRow({
      status: "PENDING_SET_PASSWORD",
      companyName: "Halfway Labs",
    });
    const finished = await customerRow({ companyName: "Halfway Labs" });

    const res = await list("?q=halfway");
    expect(ids(res.body)).toEqual([finished.id]);
    expect(res.body.data.total).toBe(1);
    expect(ids((await list("?q=halfway&downloads=none")).body)).not.toContain(
      unfinished.id,
    );
  });

  it("pages with a cursor: no overlap, total ignores the cursor, null at the end", async () => {
    const made = [];
    for (let i = 0; i < 5; i += 1) {
      made.push(await customerRow({ companyName: "Paging Ltd" }));
    }
    const newestFirst = made.map((row) => row.id).reverse();

    const first = await list("?q=paging&limit=2");
    expect(ids(first.body)).toEqual(newestFirst.slice(0, 2));
    expect(first.body.data.total).toBe(5);

    const second = await list(
      `?q=paging&limit=2&cursor=${first.body.data.nextCursor}`,
    );
    expect(ids(second.body)).toEqual(newestFirst.slice(2, 4));
    expect(second.body.data.total).toBe(5);

    const third = await list(
      `?q=paging&limit=2&cursor=${second.body.data.nextCursor}`,
    );
    expect(ids(third.body)).toEqual(newestFirst.slice(4));
    expect(third.body.data.nextCursor).toBeNull();
  });

  it("rejects a bad status, downloads filter, limit or cursor", async () => {
    const unfinished = await list("?status=PENDING_SET_PASSWORD");
    expect(unfinished.status).toBe(400);

    const status = await list("?status=PENDING");
    expect(status.status).toBe(400);
    expect(status.body.details.fieldErrors.status).toEqual([
      "Status must be one of ACTIVE, PENDING_APPROVAL, BLOCKED",
    ]);

    const downloads = await list("?downloads=some");
    expect(downloads.body.details.fieldErrors.downloads).toEqual([
      "Downloads must be any or none",
    ]);

    const limit = await list("?limit=500");
    expect(limit.body.details.fieldErrors.limit).toEqual([
      "Limit must be at most 50",
    ]);

    const cursor = await list("?cursor=garbage");
    expect(cursor.status).toBe(400);
    expect(cursor.body.code).toBe("INVALID_CURSOR");
  });

  it("is for admins only", async () => {
    for (const user of [dev, customer]) {
      expect((await list("", user)).status).toBe(403);
    }
    expect((await request(app).get("/api/admin/customers")).status).toBe(401);
  });
});
