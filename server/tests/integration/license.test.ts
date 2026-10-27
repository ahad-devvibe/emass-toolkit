import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBuckets } from "../../src/configs/storage.js";
import { LICENSE_VERSION } from "../../src/services/licenses/license.terms.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import { createUser, uniqueEmail } from "../helpers/auth.js";
import { accessCookie } from "../helpers/http.js";
import {
  createAdmin,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";
import { resetDb } from "../helpers/resetDb.js";

let dev: StaffUser;
let admin: StaffUser;
let fileId: string;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  admin = await createAdmin();
  // One published file whose object exists in the release bucket
  const product = await createProduct();
  const release = await createRelease({
    productId: product.id,
    createdById: dev.id,
    status: "PUBLISHED",
    files: [{ name: "sdk.zip" }],
  });
  const key = `releases/${product.id}/1.0.0/${randomUUID()}/sdk.zip`;
  await getStorageDriver().putStream({
    bucket: getStorageBuckets().release,
    key,
    body: (async function* () {
      yield randomBytes(64);
    })(),
  });
  const file = await prisma.releaseFile.findFirstOrThrow({
    where: { releaseId: release.id },
  });
  await prisma.releaseFile.update({
    where: { id: file.id },
    data: { objectKey: key },
  });
  fileId = file.id;
});

async function newCustomer() {
  const user = await createUser(uniqueEmail("licensee"));
  return { id: user.id, cookie: { Cookie: accessCookie(user.accessToken) } };
}

const getLicense = (cookie: { Cookie: string }) =>
  request(app).get("/api/catalog/license").set(cookie);
const accept = (cookie: { Cookie: string }) =>
  request(app).post("/api/catalog/license/accept").set(cookie);
const download = (cookie: { Cookie: string }) =>
  request(app).post(`/api/catalog/files/${fileId}/download`).set(cookie);

describe("download licence click-through", () => {
  it("serves the terms and blocks a customer's first download until accepted", async () => {
    const customer = await newCustomer();

    const terms = await getLicense(customer.cookie);
    expect(terms.status).toBe(200);
    expect(terms.body.data).toMatchObject({
      version: LICENSE_VERSION,
      title: expect.any(String),
      accepted: false,
      acceptedAt: null,
    });
    expect(terms.body.data.sections.length).toBeGreaterThan(0);

    const blocked = await download(customer.cookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("LICENSE_REQUIRED");
    expect(
      await prisma.download.count({ where: { userId: customer.id } }),
    ).toBe(0);
  });

  it("records the first acceptance once, then lets downloads through", async () => {
    const customer = await newCustomer();

    const first = await accept(customer.cookie);
    expect(first.status).toBe(200);
    expect(first.body.data.version).toBe(LICENSE_VERSION);
    const second = await accept(customer.cookie);
    expect(second.body.data.acceptedAt).toBe(first.body.data.acceptedAt);

    expect((await getLicense(customer.cookie)).body.data.accepted).toBe(true);
    expect((await download(customer.cookie)).status).toBe(200);
    expect(
      await prisma.download.count({ where: { userId: customer.id } }),
    ).toBe(1);
  });

  it("never asks staff", async () => {
    for (const user of [admin, dev]) {
      expect((await getLicense(user.cookie)).body.data.accepted).toBe(true);
      expect((await download(user.cookie)).status).toBe(200);
    }
  });

  it("keeps the record off user responses and needs a session", async () => {
    const customer = await newCustomer();
    await accept(customer.cookie);

    const me = await request(app).get("/api/auth/me").set(customer.cookie);
    expect(me.body.data).not.toHaveProperty("licenseAcceptedAt");
    expect(me.body.data).not.toHaveProperty("licenseVersion");

    expect((await request(app).get("/api/catalog/license")).status).toBe(401);
    expect(
      (await request(app).post("/api/catalog/license/accept")).status,
    ).toBe(401);
  });
});
