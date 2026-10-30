import { randomBytes } from "node:crypto";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";
import { createUpload } from "../helpers/uploads.js";

let dev: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev("Dana");
});

const patch = (id: string, body: object) =>
  request(app).patch(`/api/releases/${id}`).set(dev.cookie).send(body);

describe("drafts without a version", () => {
  it("creates a draft with only a product, so files can upload first", async () => {
    const product = await createProduct();

    const res = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: product.id });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "DRAFT", version: null });
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect([row.versionMajor, row.versionMinor, row.versionPatch]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it("allows several versionless drafts of one product", async () => {
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: null,
    });

    const res = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: product.id });

    expect(res.status).toBe(201);
  });

  it("sets the version later, and can clear it again", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: null,
    });

    const set = await patch(release.id, { version: "1.4.0" });
    expect(set.status).toBe(200);
    expect(set.body.data.version).toBe("1.4.0");

    const cleared = await patch(release.id, { version: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.version).toBeNull();
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row.versionMajor).toBeNull();
  });

  it("refuses to send a draft for review without a version", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: null,
      files: [{ kind: "DOC", format: null }],
    });

    const res = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VERSION_REQUIRED");
  });

  it("leaves versionless drafts out of the next-version suggestion", async () => {
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.2.0",
      status: "PUBLISHED",
    });
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: null,
    });

    const res = await request(app)
      .get(`/api/releases/next-version?productId=${product.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.highestShipped).toBe("1.2.0");
  });
});

describe("moving a draft to another product", () => {
  it("changes the product and keeps the version", async () => {
    const [from, to] = [await createProduct(), await createProduct()];
    const release = await createRelease({
      productId: from.id,
      createdById: dev.id,
      version: "3.0.0",
    });

    const res = await patch(release.id, { productId: to.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      version: "3.0.0",
      product: { id: to.id },
    });
  });

  it("checks the version against the new product's shipped releases", async () => {
    const [from, to] = [await createProduct(), await createProduct()];
    await createRelease({
      productId: to.id,
      createdById: dev.id,
      version: "5.0.0",
      status: "PUBLISHED",
    });
    const release = await createRelease({
      productId: from.id,
      createdById: dev.id,
      version: "2.0.0",
    });

    const res = await patch(release.id, { productId: to.id });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "VERSION_NOT_NEWER",
      details: { highestShipped: "5.0.0" },
    });
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row.productId).toBe(from.id);
  });

  it("refuses a version the new product already has", async () => {
    const [from, to] = [await createProduct(), await createProduct()];
    await createRelease({
      productId: to.id,
      createdById: dev.id,
      version: "2.0.0",
    });
    const release = await createRelease({
      productId: from.id,
      createdById: dev.id,
      version: "2.0.0",
    });

    const res = await patch(release.id, { productId: to.id });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VERSION_TAKEN");
  });

  it("moves a versionless draft freely", async () => {
    const [from, to] = [await createProduct(), await createProduct()];
    await createRelease({
      productId: to.id,
      createdById: dev.id,
      version: "9.0.0",
      status: "PUBLISHED",
    });
    const release = await createRelease({
      productId: from.id,
      createdById: dev.id,
      version: null,
    });

    const res = await patch(release.id, { productId: to.id });

    expect(res.status).toBe(200);
    expect(res.body.data.product.id).toBe(to.id);
  });
});

describe("staged object keys", () => {
  it("stores new uploads at staged/{uuid}/{name}, free of product and release", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: null,
    });

    const res = await createUpload(release.id, dev.cookie, {
      body: randomBytes(1024),
      name: "emass-sdk.zip",
    });

    expect(res.status).toBe(201);
    const session = await prisma.uploadSession.findFirstOrThrow({
      where: { releaseId: release.id },
    });
    expect(session.objectKey).toMatch(
      /^staged\/[0-9a-f-]{36}\/emass-sdk\.zip$/,
    );
  });
});
