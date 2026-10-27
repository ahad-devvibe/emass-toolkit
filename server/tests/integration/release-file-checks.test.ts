import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { BLOCK_SIZE } from "../../src/services/releases/file-inspect/range-reader.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  buildDeb,
  buildPdf,
  buildPe,
  versionInfo,
} from "../helpers/file-fixtures.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  type StaffUser,
} from "../helpers/releases.js";

let dev: StaffUser;
let otherDev: StaffUser;
let admin: StaffUser;
let customer: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  otherDev = await createDev("Omar");
  admin = await createAdmin();
  customer = await createCustomer();
});

const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

async function draft(
  options: Partial<Parameters<typeof createRelease>[0]> = {},
) {
  const product = await createProduct();
  return createRelease({
    productId: product.id,
    createdById: dev.id,
    version: "2.5.0",
    files: [],
    ...options,
  });
}

const post = (releaseId: string, body: object, user: StaffUser = dev) =>
  request(app)
    .post(`/api/releases/${releaseId}/files/check`)
    .set(user.cookie)
    .send(body);

/**
 * What the browser does: answer NEED_BYTES with the ranges asked for until
 * the server rules. Returns the final response and how many calls it took.
 */
async function check(
  releaseId: string,
  file: Buffer,
  name: string,
  extra: { sha256?: string; replace?: string } = {},
) {
  const ranges: { offset: number; data: string }[] = [];
  for (let calls = 1; calls <= 10; calls++) {
    const res = await post(releaseId, {
      name,
      size: file.length,
      ranges,
      ...extra,
    });
    if (res.status !== 200 || res.body.data.status !== "NEED_BYTES") {
      return { res, calls };
    }
    for (const { offset, length } of res.body.data.ranges) {
      ranges.push({
        offset,
        data: file.subarray(offset, offset + length).toString("base64"),
      });
    }
  }
  throw new Error("The server never ruled on the file");
}

const reasonCodes = (res: request.Response) =>
  res.body.details.reasons.map((reason: { code: string }) => reason.code);

describe("POST /api/releases/:id/files/check: the range loop", () => {
  it("asks for bytes, rules on the versions, then on the hash", async () => {
    const release = await draft();
    const exe = buildPe({ paddingBefore: 300_000 });

    const first = await post(release.id, {
      name: "setup.exe",
      size: exe.length,
    });
    expect(first.status).toBe(200);
    expect(first.body.data).toEqual({
      status: "NEED_BYTES",
      ranges: [{ offset: 0, length: BLOCK_SIZE }],
    });

    const versions = await check(release.id, exe, "setup.exe");
    expect(versions.calls).toBeLessThanOrEqual(4);
    expect(versions.res.body.data).toMatchObject({
      status: "NEED_HASH",
      format: "PE",
      warnings: [],
    });
    expect(versions.res.body.data.versions).toContainEqual({
      source: "pe",
      field: "ProductVersion",
      raw: "2.5.0",
      version: "2.5.0",
    });

    const final = await check(release.id, exe, "setup.exe", {
      sha256: sha256(exe),
    });
    expect(final.res.status).toBe(200);
    expect(final.res.body.data).toMatchObject({
      status: "ALLOWED",
      format: "PE",
    });
  });
});

describe("POST /api/releases/:id/files/check: installers", () => {
  it("blocks the same bytes as a file in another release", async () => {
    const exe = buildPe();
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.4.0",
      status: "PUBLISHED",
      files: [{ name: "emass-win.exe", sha256: sha256(exe) }],
    });
    const release = await draft();

    const { res } = await check(release.id, exe, "setup.exe", {
      sha256: sha256(exe),
    });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "FILE_BLOCKED",
      message: 'Identical to "emass-win.exe" in v2.4.0.',
      details: {
        format: "PE",
        reasons: [
          {
            code: "SAME_CONTENT",
            match: expect.objectContaining({
              sameRelease: false,
              status: "PUBLISHED",
            }),
          },
        ],
      },
    });
  });

  it("blocks the same bytes as a rolled-back build", async () => {
    const deb = buildDeb("gz");
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.5.1",
      status: "ROLLED_BACK",
      files: [{ sha256: sha256(deb) }],
    });
    const release = await draft();

    const { res } = await check(release.id, deb, "emass.deb", {
      sha256: sha256(deb),
    });

    expect(res.status).toBe(409);
    expect(reasonCodes(res)).toEqual(["SAME_CONTENT"]);
  });

  it("blocks another version before any hash is sent", async () => {
    const release = await draft();
    const { res } = await check(release.id, buildPe(), "emass_2.6.0_win.exe");

    expect(res.status).toBe(409);
    expect(res.body.details.reasons).toEqual([
      {
        code: "VERSION_MISMATCH",
        message:
          "This installer says version 2.6.0 (file name); this release is 2.5.0.",
        version: "2.6.0",
        fields: ["file name"],
        expected: "2.5.0",
      },
    ]);
  });

  it("blocks a version the product already has, naming its state", async () => {
    const release = await draft();
    const old = await createRelease({
      productId: release.productId,
      createdById: dev.id,
      version: "2.4.0",
      status: "ARCHIVED",
    });
    const exe = buildPe({ version: versionInfo("2.4.0.0", "2.4.0") });

    const { res } = await check(release.id, exe, "setup.exe");

    expect(res.status).toBe(409);
    expect(res.body.details.reasons).toEqual([
      expect.objectContaining({
        code: "VERSION_EXISTS",
        version: "2.4.0",
        releaseId: old.id,
        status: "ARCHIVED",
        message: expect.stringContaining(
          "v2.4.0 already exists and is archived",
        ),
      }),
    ]);
  });

  it("blocks a damaged installer", async () => {
    const release = await draft();
    const { res } = await check(
      release.id,
      buildDeb("missing"),
      "emass_2.5.0.deb",
    );

    expect(res.status).toBe(409);
    expect(res.body.details.reasons).toEqual([
      {
        code: "DAMAGED",
        message: "Not a valid .deb: the control archive is missing.",
      },
    ]);
  });
});

describe("POST /api/releases/:id/files/check: docs", () => {
  it("allows the same bytes as a doc in another release", async () => {
    const pdf = buildPdf("/Subject(EMASS Version 2.5.0)");
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.4.0",
      status: "PUBLISHED",
      files: [{ kind: "DOC", sha256: sha256(pdf) }],
    });
    const release = await draft();

    const { res } = await check(release.id, pdf, "guide.pdf", {
      sha256: sha256(pdf),
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "ALLOWED",
      format: "PDF",
      warnings: [],
    });
  });

  it("warns about another version instead of blocking", async () => {
    const release = await draft();
    const pdf = buildPdf("/Subject(EMASS IDE Version 1.4)");

    const { res } = await check(release.id, pdf, "User-Guide_v1.4.pdf", {
      sha256: sha256(pdf),
    });

    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toEqual([
      {
        code: "DOC_VERSION_MISMATCH",
        message:
          "This file says version 1.4.0 (file name, Info Subject); this release is 2.5.0.",
        version: "1.4.0",
        fields: ["file name", "Info Subject"],
        expected: "2.5.0",
      },
    ]);
  });

  it("warns when a file has no version anywhere", async () => {
    const release = await draft();
    const pdf = buildPdf("/Title(EMASS Guide)");

    const { res } = await check(release.id, pdf, "guide.pdf", {
      sha256: sha256(pdf),
    });

    expect(res.body.data.warnings).toEqual([
      {
        code: "NO_VERSION",
        message: "No version found in this file's name or contents.",
      },
    ]);
  });

  it("blocks the same bytes twice in one release, unless it replaces that file", async () => {
    const pdf = buildPdf("/Subject(Version 2.5.0)");
    const release = await draft({
      files: [{ kind: "DOC", name: "Guide.pdf", sha256: sha256(pdf) }],
    });

    const { res } = await check(release.id, pdf, "copy.pdf", {
      sha256: sha256(pdf),
    });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('Already in this release as "Guide.pdf".');

    const [existing] = await prisma.releaseFile.findMany({
      where: { releaseId: release.id },
    });
    const replacing = await check(release.id, pdf, "Guide.pdf", {
      sha256: sha256(pdf),
      replace: existing.id,
    });
    expect(replacing.res.status).toBe(200);
  });
});

describe("POST /api/releases/:id/files/check: validation", () => {
  it("says which field is missing or of the wrong type", async () => {
    const release = await draft();

    const missing = await post(release.id, { size: 10 });
    expect(missing.status).toBe(400);
    expect(JSON.stringify(missing.body)).toContain("Name is required");

    const wrongType = await post(release.id, { name: "a.exe", size: "10" });
    expect(wrongType.status).toBe(400);
    expect(JSON.stringify(wrongType.body)).toContain("Size must be a number");

    const badHash = await post(release.id, {
      name: "a.exe",
      size: 10,
      sha256: "abc",
    });
    expect(JSON.stringify(badHash.body)).toContain(
      "SHA-256 must be 64 hexadecimal characters",
    );
  });

  it("refuses ranges that aren't the block-aligned ranges asked for", async () => {
    const release = await draft();
    const data = Buffer.alloc(100).toString("base64");

    const misaligned = await post(release.id, {
      name: "a.exe",
      size: 200_000,
      ranges: [{ offset: 10, data }],
    });
    expect(misaligned.status).toBe(400);
    expect(misaligned.body.code).toBe("RANGE_INVALID");

    const partial = await post(release.id, {
      name: "a.exe",
      size: 200_000,
      ranges: [{ offset: 0, data }],
    });
    expect(partial.body.code).toBe("RANGE_INVALID");

    const outside = await post(release.id, {
      name: "a.exe",
      size: 50,
      ranges: [{ offset: 0, data }],
    });
    expect(outside.body.code).toBe("RANGE_INVALID");
  });

  it("refuses more than 7 MiB of ranges", async () => {
    const release = await draft();
    const big = Buffer.alloc(7 * 1024 * 1024).toString("base64");
    const block = Buffer.alloc(BLOCK_SIZE).toString("base64");

    const res = await post(release.id, {
      name: "a.exe",
      size: 8 * 1024 * 1024,
      ranges: [
        { offset: 0, data: big },
        { offset: 7 * 1024 * 1024, data: block },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("RANGES_TOO_LARGE");
  });

  it("refuses files over the upload limit", async () => {
    const release = await draft();
    const res = await post(release.id, {
      name: "a.exe",
      size: env.MAX_UPLOAD_BYTES + 1,
    });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("FILE_TOO_LARGE");
  });
});

describe("POST /api/releases/:id/files/check: access", () => {
  const body = { name: "setup.exe", size: 1000 };

  it("is only for the DEV who created the release", async () => {
    const release = await draft();

    const other = await post(release.id, body, otherDev);
    expect(other.status).toBe(403);
    expect(other.body.code).toBe("NOT_RELEASE_OWNER");

    for (const user of [admin, customer]) {
      expect((await post(release.id, body, user)).status).toBe(403);
    }
    const anonymous = await request(app)
      .post(`/api/releases/${release.id}/files/check`)
      .send(body);
    expect(anonymous.status).toBe(401);
  });

  it("refuses releases that can't be edited", async () => {
    const release = await draft({ status: "IN_REVIEW" });
    const res = await post(release.id, body);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RELEASE_LOCKED");
  });

  it("treats unknown and malformed release ids as not found", async () => {
    for (const id of ["00000000-0000-4000-8000-000000000000", "nope"]) {
      const res = await post(id, body);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RELEASE_NOT_FOUND");
    }
  });

  it("refuses a replace that isn't a file of this release", async () => {
    const release = await draft();
    const res = await post(release.id, {
      ...body,
      replace: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FILE_NOT_FOUND");
  });
});
