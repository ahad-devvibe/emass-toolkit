import { randomUUID } from "node:crypto";
import type { ReleaseStatus } from "@prisma/client";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";

let customer: StaffUser;
let dev: StaffUser;

async function release(
  productId: string,
  version: string,
  status: ReleaseStatus,
  publishedAt?: Date,
) {
  const created = await createRelease({
    productId,
    createdById: dev.id,
    version,
    status,
    releaseNotes: `Notes for ${version}`,
    files: [
      { kind: "SDK", platform: "UBUNTU", name: `sdk-${version}-linux.tar.gz` },
      { kind: "SDK", platform: "WINDOWS", name: `sdk-${version}-win.zip` },
      { kind: "DOC", name: `guide-${version}.pdf`, sizeBytes: 2048n },
    ],
  });
  if (publishedAt) {
    await prisma.release.update({
      where: { id: created.id },
      data: { publishedAt },
    });
  }
  return created;
}

const getList = () =>
  request(app).get("/api/catalog/products").set(customer.cookie);
const getProduct = (id: string) =>
  request(app).get(`/api/catalog/products/${id}`).set(customer.cookie);

beforeAll(async () => {
  await resetDb();
  customer = await createCustomer();
  dev = await createDev();
});

describe("GET /api/catalog/products", () => {
  it("lists active products with their current release and its platforms", async () => {
    const shipped = await createProduct({ name: "Core", sortOrder: 1 });
    const unreleased = await createProduct({ name: "Vision", sortOrder: 2 });
    await createProduct({ name: "Retired", isActive: false });
    const publishedAt = new Date("2026-10-12T09:00:00Z");
    await release(shipped.id, "2.0.0", "PUBLISHED", publishedAt);
    await release(shipped.id, "1.0.0", "ARCHIVED", new Date("2026-01-01"));
    await release(shipped.id, "2.1.0", "IN_REVIEW");
    await release(unreleased.id, "0.1.0", "DRAFT");

    const res = await getList();

    expect(res.status).toBe(200);
    expect(res.body.data.products).toEqual([
      {
        id: shipped.id,
        name: "Core",
        description: null,
        imageUrl: null,
        latest: {
          version: "2.0.0",
          publishedAt: publishedAt.toISOString(),
          platforms: ["WINDOWS", "UBUNTU"],
        },
      },
      {
        id: unreleased.id,
        name: "Vision",
        description: null,
        imageUrl: null,
        latest: null,
      },
    ]);
  });

  it("requires sign-in", async () => {
    const res = await request(app).get("/api/catalog/products");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/catalog/products/:id", () => {
  it("returns shipped versions only: the current one first, then archived, newest first", async () => {
    const product = await createProduct({ name: "Detail" });
    await release(product.id, "1.0.0", "ARCHIVED", new Date("2026-01-01"));
    await release(product.id, "1.2.0", "ARCHIVED", new Date("2026-05-01"));
    await release(product.id, "1.3.0", "PUBLISHED", new Date("2026-09-01"));
    for (const [version, status] of [
      ["1.4.0", "DRAFT"],
      ["1.5.0", "IN_REVIEW"],
      ["1.6.0", "CHANGES_REQUESTED"],
      ["1.1.0", "ROLLED_BACK"],
    ] as const) {
      await release(product.id, version, status);
    }

    const res = await getProduct(product.id);

    expect(res.status).toBe(200);
    const { versions } = res.body.data;
    expect(
      versions.map((v: { version: string; status: string }) => [
        v.version,
        v.status,
      ]),
    ).toEqual([
      ["1.3.0", "PUBLISHED"],
      ["1.2.0", "ARCHIVED"],
      ["1.0.0", "ARCHIVED"],
    ]);
    expect(versions[0].releaseNotes).toBe("Notes for 1.3.0");
    expect(versions[0].files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "SDK",
          platform: "WINDOWS",
          name: "sdk-1.3.0-win.zip",
          sizeBytes: 1024,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        expect.objectContaining({
          kind: "DOC",
          platform: null,
          name: "guide-1.3.0.pdf",
          sizeBytes: 2048,
        }),
      ]),
    );
    expect(res.body.data.product).toMatchObject({
      id: product.id,
      name: "Detail",
    });
    expect(res.body.data.resources).toEqual([]);
  });

  it("never sends storage keys or staff ids", async () => {
    const product = await createProduct();
    await release(product.id, "1.0.0", "PUBLISHED", new Date());

    const res = await getProduct(product.id);
    const body = JSON.stringify(res.body);

    expect(body).not.toContain("objectKey");
    expect(body).not.toContain("staged/");
    expect(body).not.toContain(dev.id);
  });

  it("answers 404 for an inactive, unknown or malformed product id", async () => {
    const inactive = await createProduct({ isActive: false });
    await release(inactive.id, "1.0.0", "PUBLISHED", new Date());

    for (const id of [inactive.id, randomUUID(), "not-a-uuid"]) {
      const res = await getProduct(id);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("PRODUCT_NOT_FOUND");
    }
  });

  it("shows a product with nothing shipped as having no versions", async () => {
    const product = await createProduct();
    await release(product.id, "0.1.0", "DRAFT");

    const res = await getProduct(product.id);
    expect(res.status).toBe(200);
    expect(res.body.data.versions).toEqual([]);
  });

  it("requires sign-in", async () => {
    const res = await request(app).get(`/api/catalog/products/${randomUUID()}`);
    expect(res.status).toBe(401);
  });
});
