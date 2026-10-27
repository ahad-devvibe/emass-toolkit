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
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";

let dev: StaffUser;
let admin: StaffUser;
let customer: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev("Dana");
  admin = await createAdmin();
  customer = await createCustomer();
});

describe("GET /api/products", () => {
  it("lists active products in catalog order for any signed-in user", async () => {
    const second = await createProduct({ name: "Zeta SDK", sortOrder: 1 });
    const first = await createProduct({ name: "Alpha SDK", sortOrder: 0 });
    await createProduct({ name: "Hidden SDK", isActive: false });

    const res = await request(app).get("/api/products").set(customer.cookie);

    expect(res.status).toBe(200);
    const ids = res.body.data.products.map((p: { id: string }) => p.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(
      res.body.data.products.some(
        (p: { name: string }) => p.name === "Hidden SDK",
      ),
    ).toBe(false);
    expect(Object.keys(res.body.data.products[0]).sort()).toEqual([
      "description",
      "id",
      "imageUrl",
      "name",
    ]);
  });

  it("requires sign-in", async () => {
    const res = await request(app).get("/api/products");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/releases", () => {
  it("lists newest first with file totals and per-status counts", async () => {
    const product = await createProduct({ name: "Listing SDK" });
    const older = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.0.0",
      status: "PUBLISHED",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      files: [
        { platform: "WINDOWS", sizeBytes: 100n },
        { platform: "MACOS", sizeBytes: 50n },
      ],
    });
    const newer = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.1.0",
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });

    const res = await request(app)
      .get(`/api/releases?productId=${product.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    const { releases, counts, nextCursor } = res.body.data;
    expect(releases.map((r: { id: string }) => r.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(releases[1]).toMatchObject({
      product: { id: product.id, name: "Listing SDK" },
      version: "1.0.0",
      status: "PUBLISHED",
      fileCount: 2,
      totalBytes: 150,
      createdBy: { id: dev.id, name: "Dana User", role: "DEV" },
    });
    expect(releases[0]).toMatchObject({ fileCount: 0, totalBytes: 0 });
    expect(counts).toEqual({
      DRAFT: 1,
      IN_REVIEW: 0,
      CHANGES_REQUESTED: 0,
      PUBLISHED: 1,
      ARCHIVED: 0,
      ROLLED_BACK: 0,
    });
    expect(nextCursor).toBeNull();
  });

  it("filters by status while counts ignore the status filter", async () => {
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.0.0",
      status: "IN_REVIEW",
    });
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.1.0",
    });

    const res = await request(app)
      .get(`/api/releases?productId=${product.id}&status=IN_REVIEW`)
      .set(admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.releases).toHaveLength(1);
    expect(res.body.data.releases[0].status).toBe("IN_REVIEW");
    expect(res.body.data.counts).toMatchObject({ IN_REVIEW: 1, DRAFT: 1 });
  });

  it("filters by several comma-separated statuses", async () => {
    const product = await createProduct();
    for (const [version, status] of [
      ["1.0.0", "ARCHIVED"],
      ["1.1.0", "ROLLED_BACK"],
      ["1.2.0", "PUBLISHED"],
    ] as const) {
      await createRelease({
        productId: product.id,
        createdById: dev.id,
        version,
        status,
      });
    }

    const res = await request(app)
      .get(`/api/releases?productId=${product.id}&status=ARCHIVED,ROLLED_BACK`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(
      res.body.data.releases.map((r: { status: string }) => r.status).sort(),
    ).toEqual(["ARCHIVED", "ROLLED_BACK"]);

    const bad = await request(app)
      .get("/api/releases?status=ARCHIVED,LIVE")
      .set(dev.cookie);
    expect(bad.status).toBe(400);
  });

  it("searches by version, product name and creator name", async () => {
    const product = await createProduct({ name: "Searchable Vision" });
    const other = await createDev("Orla");
    await createRelease({
      productId: product.id,
      createdById: other.id,
      version: "7.3.1",
    });

    for (const q of ["7.3.1", "searchable", "orla", "vision 7.3"]) {
      const res = await request(app)
        .get(`/api/releases?q=${encodeURIComponent(q)}`)
        .set(dev.cookie);
      expect(res.status).toBe(200);
      expect(
        res.body.data.releases.map((r: { version: string }) => r.version),
      ).toContain("7.3.1");
    }

    const miss = await request(app)
      .get("/api/releases?q=nothing-matches-this")
      .set(dev.cookie);
    expect(miss.body.data.releases).toEqual([]);
  });

  it("paginates with a cursor without overlap", async () => {
    const product = await createProduct();
    const versions = ["1.0.0", "1.0.1", "1.0.2"];
    for (const [day, version] of versions.entries()) {
      await createRelease({
        productId: product.id,
        createdById: dev.id,
        version,
        createdAt: new Date(Date.UTC(2026, 0, day + 1)),
      });
    }

    const first = await request(app)
      .get(`/api/releases?productId=${product.id}&limit=2`)
      .set(dev.cookie);
    expect(first.body.data.releases).toHaveLength(2);
    expect(first.body.data.nextCursor).toEqual(expect.any(String));

    const second = await request(app)
      .get(
        `/api/releases?productId=${product.id}&limit=2&cursor=${first.body.data.nextCursor}`,
      )
      .set(dev.cookie);
    expect(second.body.data.releases).toHaveLength(1);
    expect(second.body.data.nextCursor).toBeNull();

    const paged = [
      ...first.body.data.releases,
      ...second.body.data.releases,
    ].map((r: { version: string }) => r.version);
    expect(paged).toEqual([...versions].reverse());
  });

  it("rejects an invalid cursor and bad filters", async () => {
    const cursor = await request(app)
      .get("/api/releases?cursor=garbage")
      .set(dev.cookie);
    expect(cursor.status).toBe(400);
    expect(cursor.body.code).toBe("INVALID_CURSOR");

    const status = await request(app)
      .get("/api/releases?status=LIVE")
      .set(dev.cookie);
    expect(status.status).toBe(400);
    expect(status.body.code).toBe("VALIDATION_ERROR");
  });

  it("is staff only", async () => {
    expect((await request(app).get("/api/releases")).status).toBe(401);
    const res = await request(app).get("/api/releases").set(customer.cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/releases/:id", () => {
  it("returns files and events without storage keys", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      releaseNotes: "## Fixes",
      files: [
        { platform: "UBUNTU", name: "emass.deb", sizeBytes: 5_000_000_000n },
        { kind: "DOC", name: "guide.pdf" },
      ],
    });

    const res = await request(app)
      .get(`/api/releases/${release.id}`)
      .set(admin.cookie);

    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body).toMatchObject({
      id: release.id,
      releaseNotes: "## Fixes",
      fileCount: 2,
      totalBytes: 5_000_000_000 + 1024,
      publishedAt: null,
      publishedBy: null,
    });
    expect(body.files[0]).toMatchObject({
      kind: "SDK",
      platform: "UBUNTU",
      name: "emass.deb",
      sizeBytes: 5_000_000_000,
    });
    expect(body.files[1]).toMatchObject({ kind: "DOC", platform: null });
    expect(body.events).toEqual([
      expect.objectContaining({
        type: "CREATED",
        actor: { id: dev.id, name: "Dana User", role: "DEV" },
        note: null,
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain("objectKey");
    expect(JSON.stringify(res.body)).not.toContain("staged/");
  });

  it("answers 404 for unknown and malformed ids", async () => {
    for (const id of ["9f0f9b4e-6f6a-4a3c-9a3c-2f5b8e1d0c11", "not-an-id"]) {
      const res = await request(app).get(`/api/releases/${id}`).set(dev.cookie);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RELEASE_NOT_FOUND");
    }
  });
});

describe("GET /api/releases/next-version", () => {
  it("suggests from 0.0.0 when nothing exists", async () => {
    const product = await createProduct();
    const res = await request(app)
      .get(`/api/releases/next-version?productId=${product.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      highestShipped: null,
      suggestions: { patch: "0.0.1", minor: "0.1.0", major: "1.0.0" },
    });
  });

  it("reports the highest shipped and skips versions taken by drafts", async () => {
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.4.0",
      status: "ARCHIVED",
    });
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.5.0",
      status: "PUBLISHED",
    });
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.5.1",
    });

    const res = await request(app)
      .get(`/api/releases/next-version?productId=${product.id}`)
      .set(dev.cookie);

    expect(res.body.data).toEqual({
      highestShipped: "2.5.0",
      suggestions: { patch: "2.5.2", minor: "2.6.0", major: "3.0.0" },
    });
  });

  it("answers 404 for unknown or inactive products, 400 without one", async () => {
    const inactive = await createProduct({ isActive: false });
    const res = await request(app)
      .get(`/api/releases/next-version?productId=${inactive.id}`)
      .set(dev.cookie);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PRODUCT_NOT_FOUND");

    const missing = await request(app)
      .get("/api/releases/next-version")
      .set(dev.cookie);
    expect(missing.status).toBe(400);
    expect(missing.body.details.fieldErrors.productId).toEqual([
      "Product is required",
    ]);
  });
});

describe("POST /api/releases", () => {
  it("creates a draft with a CREATED event", async () => {
    const product = await createProduct();

    const res = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: product.id, version: "1.2.3", releaseNotes: "Hi" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      version: "1.2.3",
      status: "DRAFT",
      releaseNotes: "Hi",
      createdBy: { id: dev.id },
      files: [],
    });
    expect(res.body.data.events).toEqual([
      expect.objectContaining({
        type: "CREATED",
        actor: expect.objectContaining({ id: dev.id }),
      }),
    ]);
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: res.body.data.id },
    });
    expect([row.versionMajor, row.versionMinor, row.versionPatch]).toEqual([
      1, 2, 3,
    ]);
  });

  it("distinguishes missing fields from wrong types", async () => {
    const missing = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({});
    expect(missing.status).toBe(400);
    expect(missing.body.details.fieldErrors).toMatchObject({
      productId: ["Product is required"],
      version: ["Version is required"],
    });

    const wrongType = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: 42, version: 123 });
    expect(wrongType.body.details.fieldErrors).toMatchObject({
      productId: ["Product must be a valid id"],
      version: ["Version must be text"],
    });
  });

  it("rejects malformed versions", async () => {
    const product = await createProduct();
    for (const version of [
      "1.2",
      "01.2.3",
      "v1.2.3",
      "1.2.3-beta",
      "1000000.0.0",
    ]) {
      const res = await request(app)
        .post("/api/releases")
        .set(dev.cookie)
        .send({ productId: product.id, version });
      expect(res.status, version).toBe(400);
      expect(res.body.details.fieldErrors.version).toEqual([
        "Version must look like 1.2.3",
      ]);
    }
  });

  it("requires a version newer than the highest shipped", async () => {
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.0.0",
      status: "ROLLED_BACK",
    });

    for (const version of ["1.9.9", "2.0.0"]) {
      const res = await request(app)
        .post("/api/releases")
        .set(dev.cookie)
        .send({ productId: product.id, version });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "VERSION_NOT_NEWER",
        details: { highestShipped: "2.0.0" },
      });
    }
  });

  it("rejects a version another release already has", async () => {
    const product = await createProduct();
    const other = await createDev();
    await createRelease({
      productId: product.id,
      createdById: other.id,
      version: "3.0.0",
    });

    const res = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: product.id, version: "3.0.0" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VERSION_TAKEN");
  });

  it("answers 404 for an inactive product", async () => {
    const product = await createProduct({ isActive: false });
    const res = await request(app)
      .post("/api/releases")
      .set(dev.cookie)
      .send({ productId: product.id, version: "1.0.0" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("is for DEVs only", async () => {
    const product = await createProduct();
    for (const user of [admin, customer]) {
      const res = await request(app)
        .post("/api/releases")
        .set(user.cookie)
        .send({ productId: product.id, version: "1.0.0" });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
    expect(
      await prisma.release.count({ where: { productId: product.id } }),
    ).toBe(0);
  });
});

describe("PATCH /api/releases/:id", () => {
  it("updates version and notes without adding events", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.0.0",
    });

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ version: "1.1.0", releaseNotes: "New notes" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      version: "1.1.0",
      releaseNotes: "New notes",
    });
    expect(res.body.data.events).toHaveLength(1);
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row.versionMinor).toBe(1);
  });

  it("allows edits while changes are requested", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      status: "CHANGES_REQUESTED",
    });
    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ releaseNotes: "Fixed" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("CHANGES_REQUESTED");
  });

  it("rejects an empty body", async () => {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
    });
    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.details.formErrors).toEqual([
      "Send a version, release notes or file mappings to update",
    ]);
  });

  it("applies the version rules", async () => {
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.0.0",
      status: "PUBLISHED",
    });
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.1.0",
    });
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.2.0",
    });

    const older = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ version: "1.0.0" });
    expect(older.body.code).toBe("VERSION_NOT_NEWER");

    const taken = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ version: "2.1.0" });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe("VERSION_TAKEN");
  });

  it("is locked once the release is in review or shipped", async () => {
    const product = await createProduct();
    for (const [status, version] of [
      ["IN_REVIEW", "1.0.0"],
      ["PUBLISHED", "1.0.1"],
    ] as const) {
      const release = await createRelease({
        productId: product.id,
        createdById: dev.id,
        version,
        status,
      });
      const res = await request(app)
        .patch(`/api/releases/${release.id}`)
        .set(dev.cookie)
        .send({ releaseNotes: "x" });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({
        code: "RELEASE_LOCKED",
        details: { status },
      });
    }
  });
});

describe("PATCH /api/releases/:id with file mappings", () => {
  async function draftWith(
    files: Parameters<typeof createRelease>[0]["files"],
  ) {
    const product = await createProduct();
    const release = await createRelease({
      productId: product.id,
      createdById: dev.id,
      files,
    });
    const rows = await prisma.releaseFile.findMany({
      where: { releaseId: release.id },
      orderBy: { originalName: "asc" },
    });
    return { release, rows };
  }

  const mappingsOf = async (releaseId: string) =>
    (
      await prisma.releaseFile.findMany({
        where: { releaseId },
        orderBy: { originalName: "asc" },
      })
    ).map((row) => [row.originalName, row.kind, row.platform]);

  it("maps an unmapped file and saves notes in the same request", async () => {
    const { release, rows } = await draftWith([
      { kind: null, platform: null, name: "a.zip" },
    ]);

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({
        releaseNotes: "Notes",
        files: [{ id: rows[0].id, kind: "SDK", platform: "MACOS" }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ releaseNotes: "Notes" });
    expect(res.body.data.files[0]).toMatchObject({
      kind: "SDK",
      platform: "MACOS",
    });
  });

  it("swaps two platforms in one save", async () => {
    const { release, rows } = await draftWith([
      { platform: "WINDOWS", name: "a.bin" },
      { platform: "MACOS", name: "b.bin" },
    ]);

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({
        files: [
          { id: rows[0].id, kind: "SDK", platform: "MACOS" },
          { id: rows[1].id, kind: "SDK", platform: "WINDOWS" },
        ],
      });

    expect(res.status).toBe(200);
    expect(await mappingsOf(release.id)).toEqual([
      ["a.bin", "SDK", "MACOS"],
      ["b.bin", "SDK", "WINDOWS"],
    ]);
  });

  it("rejects a duplicate platform in the final state and changes nothing", async () => {
    const { release, rows } = await draftWith([
      { platform: "WINDOWS", name: "a.bin" },
      { kind: "DOC", name: "b.pdf" },
    ]);

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({
        releaseNotes: "should not save",
        files: [{ id: rows[1].id, kind: "SDK", platform: "WINDOWS" }],
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DUPLICATE_PLATFORM");
    expect(res.body.details.duplicates).toEqual([
      {
        platform: "WINDOWS",
        fileIds: expect.arrayContaining([rows[0].id, rows[1].id]),
      },
    ]);
    expect(await mappingsOf(release.id)).toEqual([
      ["a.bin", "SDK", "WINDOWS"],
      ["b.pdf", "DOC", null],
    ]);
    const saved = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(saved.releaseNotes).toBe("");
  });

  it("lets a draft keep an SDK without a platform or an unmapped file", async () => {
    const { release, rows } = await draftWith([
      { platform: "WINDOWS", name: "a.bin" },
      { kind: "DOC", name: "b.pdf" },
    ]);

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({
        files: [
          { id: rows[0].id, kind: "SDK", platform: null },
          { id: rows[1].id, kind: null },
        ],
      });

    expect(res.status).toBe(200);
    expect(await mappingsOf(release.id)).toEqual([
      ["a.bin", "SDK", null],
      ["b.pdf", null, null],
    ]);
  });

  it("drops a platform when a file becomes a doc", async () => {
    const { release, rows } = await draftWith([
      { platform: "UBUNTU", name: "a.deb" },
    ]);

    await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ files: [{ id: rows[0].id, kind: "DOC" }] })
      .expect(200);

    expect(await mappingsOf(release.id)).toEqual([["a.deb", "DOC", null]]);
  });

  it("validates each mapping", async () => {
    const { release, rows } = await draftWith([{ kind: "DOC", name: "a.pdf" }]);

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ files: [{ id: rows[0].id, kind: "DOC", platform: "WINDOWS" }] });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("answers 404 for a file of another release", async () => {
    const { release } = await draftWith([]);
    const { rows: foreign } = await draftWith([{ kind: "DOC" }]);

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ files: [{ id: foreign[0].id, kind: "DOC" }] });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FILE_NOT_FOUND");
  });

  it("is for the creating DEV only", async () => {
    const { release, rows } = await draftWith([{ kind: "DOC" }]);
    const other = await createDev("Oscar");
    const body = { files: [{ id: rows[0].id, kind: null }] };

    const res = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(other.cookie)
      .send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("NOT_RELEASE_OWNER");

    const asAdmin = await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(admin.cookie)
      .send(body);
    expect(asAdmin.status).toBe(403);
    expect(await mappingsOf(release.id)).toEqual([
      [rows[0].originalName, "DOC", null],
    ]);
  });
});

describe("GET /api/releases needsYou", () => {
  const needsYou = async (user: StaffUser, query = "") =>
    (await request(app).get(`/api/releases${query}`).set(user.cookie)).body.data
      .needsYou as number;

  it("counts an admin's reviews and only a dev's own sent-back releases, ignoring filters", async () => {
    const devB = await createDev("Bea");
    const before = {
      a: await needsYou(dev),
      b: await needsYou(devB),
      admin: await needsYou(admin),
    };
    const product = await createProduct();
    const make = (
      createdById: string,
      status: "CHANGES_REQUESTED" | "IN_REVIEW",
      version: string,
    ) => createRelease({ productId: product.id, createdById, status, version });
    await make(dev.id, "CHANGES_REQUESTED", "7.0.1");
    await make(dev.id, "CHANGES_REQUESTED", "7.0.2");
    await make(devB.id, "CHANGES_REQUESTED", "7.0.3");
    await make(dev.id, "IN_REVIEW", "7.0.4");
    await make(devB.id, "IN_REVIEW", "7.0.5");
    await make(dev.id, "IN_REVIEW", "7.0.6");

    expect((await needsYou(dev)) - before.a).toBe(2);
    expect((await needsYou(devB)) - before.b).toBe(1);
    expect((await needsYou(admin)) - before.admin).toBe(3);
    // Filters narrow the list, never the badge
    expect(await needsYou(dev, "?status=PUBLISHED&q=zzz")).toBe(before.a + 2);
  });
});
