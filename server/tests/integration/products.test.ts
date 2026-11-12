import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { prisma } from "../../src/configs/prisma.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  type StaffUser,
} from "../helpers/releases.js";

let dev: StaffUser;
let admin: StaffUser;
let customer: StaffUser;

const portalLink = { url: "https://example.com/portal", label: "Open portal" };
// A full, valid update body
const card = {
  name: "Model Zoo",
  description: "Pick a model here.",
  url: portalLink.url,
  label: portalLink.label,
};

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  admin = await createAdmin();
  customer = await createCustomer();
});

describe("link products and releases", () => {
  it("keeps link products out of the release product picker", async () => {
    const shipping = await createProduct({ name: "Shipping SDK" });
    const link = await createProduct({ name: "Portal", link: portalLink });

    const res = await request(app).get("/api/products").set(dev.cookie);

    const ids = res.body.data.products.map((p: { id: string }) => p.id);
    expect(ids).toContain(shipping.id);
    expect(ids).not.toContain(link.id);
  });

  it("refuses to start a release or suggest a version for a link product", async () => {
    const link = await createProduct({ link: portalLink });

    const created = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: link.id, version: "1.0.0" });
    expect(created.status).toBe(404);
    expect(created.body.code).toBe("PRODUCT_NOT_FOUND");

    const suggested = await request(app)
      .get(`/api/releases/next-version?productId=${link.id}`)
      .set(dev.cookie);
    expect(suggested.status).toBe(404);
    expect(await prisma.release.count({ where: { productId: link.id } })).toBe(
      0,
    );
  });
});

describe("GET /api/products/external", () => {
  it("lists external products with their card for developers", async () => {
    const link = await createProduct({ name: "Docs portal", link: portalLink });
    const shipping = await createProduct();

    const res = await request(app)
      .get("/api/products/external")
      .set(dev.cookie);

    expect(res.status).toBe(200);
    const ids = res.body.data.products.map((p: { id: string }) => p.id);
    expect(ids).not.toContain(shipping.id);
    expect(
      res.body.data.products.find((p: { id: string }) => p.id === link.id),
    ).toMatchObject({
      name: "Docs portal",
      description: null,
      isActive: true,
      link: portalLink,
    });
  });

  it("is for developers only", async () => {
    for (const user of [admin, customer]) {
      const res = await request(app)
        .get("/api/products/external")
        .set(user.cookie);
      expect(res.status).toBe(403);
    }
    expect((await request(app).get("/api/products/external")).status).toBe(
      401,
    );
  });
});

describe("PATCH /api/products/:id/external", () => {
  const patch = (id: string, user: StaffUser, body: unknown) =>
    request(app)
      .patch(`/api/products/${id}/external`)
      .set(user.cookie)
      .send(body as object);

  it("updates the name, description, URL and button label, trimmed", async () => {
    const link = await createProduct({ link: portalLink });

    const res = await patch(link.id, dev, {
      name: "  Model Zoo  ",
      description: "  Hosted externally.  ",
      url: "  https://example.com/new  ",
      label: "  Visit  ",
    });

    expect(res.status).toBe(200);
    expect(res.body.data.product).toMatchObject({
      name: "Model Zoo",
      description: "Hosted externally.",
      link: { url: "https://example.com/new", label: "Visit" },
    });
    const catalog = await request(app)
      .get("/api/catalog/products")
      .set(customer.cookie);
    expect(
      catalog.body.data.products.find((p: { id: string }) => p.id === link.id),
    ).toMatchObject({
      name: "Model Zoo",
      description: "Hosted externally.",
      link: { url: "https://example.com/new", label: "Visit" },
    });
  });

  it("clears the description when it's empty, null or left out", async () => {
    const link = await createProduct({ link: portalLink });

    for (const description of ["   ", null, undefined]) {
      await patch(link.id, dev, card);
      const res = await patch(link.id, dev, { ...card, description });
      expect(res.status).toBe(200);
      expect(res.body.data.product.description).toBeNull();
    }
  });

  it("is for developers only", async () => {
    const link = await createProduct({ link: portalLink });

    for (const user of [admin, customer]) {
      const res = await patch(link.id, user, {
        ...card,
        url: "https://example.com/other",
      });
      expect(res.status).toBe(403);
    }
    const row = await prisma.product.findUniqueOrThrow({
      where: { id: link.id },
    });
    expect(row.linkUrl).toBe(portalLink.url);
  });

  it("answers 404 for a product that ships releases, or an unknown or malformed id", async () => {
    const shipping = await createProduct({ name: "Core SDK" });

    for (const id of [shipping.id, randomUUID(), "not-a-uuid"]) {
      const res = await patch(id, dev, card);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("PRODUCT_NOT_FOUND");
    }
    const row = await prisma.product.findUniqueOrThrow({
      where: { id: shipping.id },
    });
    expect(row).toMatchObject({ name: "Core SDK", linkUrl: null });
  });

  it("tells missing fields from wrong types", async () => {
    const link = await createProduct({ link: portalLink });

    const missing = await patch(link.id, dev, {});
    expect(missing.status).toBe(400);
    expect(missing.body.details.fieldErrors).toEqual({
      name: ["Name is required"],
      url: ["URL is required"],
      label: ["Button label is required"],
    });

    const wrongType = await patch(link.id, dev, {
      name: 1,
      description: 2,
      url: 3,
      label: false,
    });
    expect(wrongType.body.details.fieldErrors).toEqual({
      name: ["Name must be text"],
      description: ["Description must be text"],
      url: ["URL must be text"],
      label: ["Button label must be text"],
    });
  });

  it("accepts only https links and enforces the lengths", async () => {
    const link = await createProduct({ link: portalLink });

    for (const url of [
      "http://example.com",
      "javascript:alert(1)",
      "example.com",
      "",
    ]) {
      const res = await patch(link.id, dev, { ...card, url });
      expect(res.status).toBe(400);
      expect(res.body.details.fieldErrors.url).toEqual([
        "URL must be a full https:// link",
      ]);
    }

    const blank = await patch(link.id, dev, { ...card, name: " ", label: " " });
    expect(blank.body.details.fieldErrors).toEqual({
      name: ["Name is required"],
      label: ["Button label is required"],
    });

    const long = await patch(link.id, dev, {
      ...card,
      name: "x".repeat(81),
      description: "x".repeat(201),
      label: "x".repeat(41),
    });
    expect(long.body.details.fieldErrors).toEqual({
      name: ["Name must be at most 80 characters"],
      description: ["Description must be at most 200 characters"],
      label: ["Button label must be at most 40 characters"],
    });
  });
});
