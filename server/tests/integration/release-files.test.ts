import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBuckets } from "../../src/configs/storage.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  stagedFilesFor,
  stagedObjectExists,
  type StaffUser,
} from "../helpers/releases.js";
import { buildPdfDocument, buildPe } from "../helpers/file-fixtures.js";
import {
  completeUpload,
  createUpload,
  putPart,
  uploadInParts,
} from "../helpers/uploads.js";

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

afterEach(() => {
  vi.restoreAllMocks();
});

async function draft(
  options: Partial<Parameters<typeof createRelease>[0]> = {},
) {
  const product = await createProduct();
  return createRelease({
    productId: product.id,
    createdById: dev.id,
    files: [],
    ...options,
  });
}

// The browser's protocol: create the session, send the parts, complete.
// The hash is sent unless a test overrides it ("" leaves it out).
function upload(
  releaseId: string,
  fields: Record<string, string>,
  file: { body: Buffer; name: string; type?: string },
  user: StaffUser = dev,
) {
  return uploadInParts(releaseId, user.cookie, file, fields);
}

async function storedBytes(objectKey: string): Promise<Buffer> {
  const { staging } = getStorageBuckets();
  return readFile(path.resolve(env.STORAGE_LOCAL_DIR, staging, objectKey));
}

async function fileRows(releaseId: string) {
  return prisma.releaseFile.findMany({ where: { releaseId } });
}

const sha256 = (data: Buffer) =>
  createHash("sha256").update(data).digest("hex");

describe("uploading a file (create, parts, complete)", () => {
  it("streams an SDK into staging with a server-computed SHA-256", async () => {
    const release = await draft();
    const body = randomBytes(3 * 1024 ** 2);

    const res = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS" },
      { body, name: "emass-core-2.5.0.msi", type: "application/x-msi" },
    );

    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({
      kind: "SDK",
      platform: "WINDOWS",
      name: "emass-core-2.5.0.msi",
      contentType: "application/x-msi",
      sizeBytes: body.length,
      sha256: sha256(body),
    });
    const [row] = await fileRows(release.id);
    expect(row.objectKey).toMatch(
      new RegExp(
        `^staged/${release.productId}/${release.id}/[0-9a-f-]{36}/emass-core-2\\.5\\.0\\.msi$`,
      ),
    );
    expect((await storedBytes(row.objectKey)).equals(body)).toBe(true);
  });

  it("stores docs without a platform and keeps unsafe names readable", async () => {
    const release = await draft();

    const res = await upload(
      release.id,
      { kind: "DOC" },
      {
        body: buildPdfDocument(),
        name: "../My Guide (v2).pdf",
        type: "application/pdf",
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({
      kind: "DOC",
      platform: null,
      contentType: "application/pdf",
    });
    const [row] = await fileRows(release.id);
    expect(row.objectKey.endsWith("/My-Guide-v2-.pdf")).toBe(true);
    expect(row.objectKey).not.toContain("..");
  });

  it("keeps UTF-8 file names intact", async () => {
    const release = await draft();
    const res = await upload(
      release.id,
      { kind: "DOC" },
      { body: Buffer.from("x"), name: "Résumé.pdf" },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.file.name).toBe("Résumé.pdf");
  });

  it("validates kind and platform", async () => {
    const release = await draft();
    const file = { body: Buffer.from("x"), name: "a.bin" };
    const cases: [Record<string, string>, Record<string, string[]>][] = [
      [{ kind: "SDK" }, { platform: ["Platform is required for an SDK"] }],
      [
        { kind: "DOC", platform: "MACOS" },
        { platform: ["Docs don't have a platform"] },
      ],
      [{ kind: "BINARY" }, { kind: ["Kind must be SDK or DOC"] }],
      [
        { platform: "MACOS" },
        { platform: ["Choose a type before a platform"] },
      ],
      [
        { kind: "SDK", platform: "LINUX" },
        { platform: ["Platform must be WINDOWS, MACOS or UBUNTU"] },
      ],
    ];

    for (const [fields, fieldErrors] of cases) {
      const res = await upload(release.id, fields, file);
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect(res.body.details.fieldErrors).toMatchObject(fieldErrors);
    }
    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("stores an upload without a kind as unmapped", async () => {
    const release = await draft();

    const res = await upload(
      release.id,
      {},
      { body: Buffer.from("mystery"), name: "mystery.zip" },
    );

    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({ kind: null, platform: null });
    const [row] = await fileRows(release.id);
    expect(row).toMatchObject({ kind: null, platform: null });
  });

  it("refuses an empty file before storing anything", async () => {
    const release = await draft();

    const empty = await upload(
      release.id,
      { kind: "DOC" },
      { body: Buffer.alloc(0), name: "empty.pdf" },
    );

    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("VALIDATION_ERROR");
    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  describe("size cap", () => {
    const original = env.MAX_UPLOAD_BYTES;
    afterEach(() => {
      env.MAX_UPLOAD_BYTES = original;
    });

    it("refuses a file over the cap before any part is sent", async () => {
      env.MAX_UPLOAD_BYTES = 1024 ** 2;
      const release = await draft();

      const res = await upload(
        release.id,
        { kind: "SDK", platform: "MACOS" },
        { body: randomBytes(1.5 * 1024 ** 2), name: "big.dmg" },
      );

      expect(res.status).toBe(413);
      expect(res.body.code).toBe("FILE_TOO_LARGE");
      expect(await fileRows(release.id)).toEqual([]);
      expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
    });
  });

  it("answers PLATFORM_TAKEN with the holder's id and keeps it", async () => {
    const release = await draft();
    const first = await upload(
      release.id,
      { kind: "SDK", platform: "UBUNTU" },
      { body: Buffer.from("one"), name: "one.deb" },
    );

    const res = await upload(
      release.id,
      { kind: "SDK", platform: "UBUNTU" },
      { body: Buffer.from("two"), name: "two.deb" },
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "PLATFORM_TAKEN",
      details: { fileId: first.body.data.file.id },
    });
    const rows = await fileRows(release.id);
    expect(rows.map((row) => row.originalName)).toEqual(["one.deb"]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([
      "one.deb",
    ]);
  });

  it("replaces a file: new row and object in, old ones out", async () => {
    const release = await draft();
    const first = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS" },
      { body: Buffer.from("old build"), name: "old.msi" },
    );
    const oldKey = (await fileRows(release.id))[0].objectKey;

    const res = await upload(
      release.id,
      {
        kind: "SDK",
        platform: "WINDOWS",
        replace: first.body.data.file.id,
      },
      { body: Buffer.from("new build"), name: "new.msi" },
    );

    expect(res.status).toBe(201);
    const rows = await fileRows(release.id);
    expect(rows.map((row) => row.originalName)).toEqual(["new.msi"]);
    expect(await stagedObjectExists(oldKey)).toBe(false);
    expect(await stagedObjectExists(rows[0].objectKey)).toBe(true);
  });

  it("keeps the old file when a replacement upload fails", async () => {
    const release = await draft();
    const first = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS" },
      { body: Buffer.from("old build"), name: "old.msi" },
    );
    const oldKey = (await fileRows(release.id))[0].objectKey;
    vi.spyOn(getStorageDriver(), "uploadPart").mockRejectedValueOnce(
      new ApiError(502, "Unable to upload file", "UPLOAD_FAILED"),
    );

    const res = await upload(
      release.id,
      {
        kind: "SDK",
        platform: "WINDOWS",
        replace: first.body.data.file.id,
      },
      { body: Buffer.from("new build"), name: "new.msi" },
    );

    expect(res.status).toBe(502);
    const rows = await fileRows(release.id);
    expect(rows.map((row) => row.originalName)).toEqual(["old.msi"]);
    expect(await stagedObjectExists(oldKey)).toBe(true);
  });

  it("rejects replacing a file from another release", async () => {
    const release = await draft();
    const other = await draft({ files: [{ kind: "DOC" }] });
    const [foreign] = await fileRows(other.id);

    const res = await upload(
      release.id,
      { kind: "DOC", replace: foreign.id },
      { body: Buffer.from("x"), name: "a.pdf" },
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("FILE_NOT_FOUND");
  });

  it("deletes the object when the row can't be saved", async () => {
    const release = await draft();
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    const res = await upload(
      release.id,
      { kind: "DOC" },
      { body: Buffer.from("x"), name: "a.pdf" },
    );

    expect(res.status).toBe(500);
    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("refuses to complete an upload after the release was submitted", async () => {
    const release = await draft({ files: [{ platform: "MACOS" }] });
    const body = randomBytes(512 * 1024);
    const file = { body, name: "late.msi" };
    const created = await createUpload(release.id, dev.cookie, file, {
      kind: "SDK",
      platform: "WINDOWS",
    });
    const { uploadId } = created.body.data;
    expect(
      (await putPart(release.id, dev.cookie, uploadId, 1, body)).status,
    ).toBe(200);

    const submitted = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(submitted.status).toBe(200);

    const res = await completeUpload(release.id, dev.cookie, uploadId);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RELEASE_LOCKED");
    const rows = await fileRows(release.id);
    expect(rows.map((row) => row.platform)).toEqual(["MACOS"]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });
});

describe("DELETE /api/releases/:id/files/:fileId", () => {
  it("deletes the object, then the row", async () => {
    const release = await draft({
      files: [{ kind: "DOC" }],
      withObjects: true,
    });
    const [file] = await fileRows(release.id);

    const res = await request(app)
      .delete(`/api/releases/${release.id}/files/${file.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedObjectExists(file.objectKey)).toBe(false);

    const again = await request(app)
      .delete(`/api/releases/${release.id}/files/${file.id}`)
      .set(dev.cookie);
    expect(again.status).toBe(404);
  });

  it("keeps the row when the object can't be deleted", async () => {
    const release = await draft({
      files: [{ kind: "DOC" }],
      withObjects: true,
    });
    const [file] = await fileRows(release.id);
    vi.spyOn(getStorageDriver(), "deleteObject").mockRejectedValue(
      new ApiError(502, "Unable to delete file", "DELETE_FAILED"),
    );

    const res = await request(app)
      .delete(`/api/releases/${release.id}/files/${file.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(502);
    expect(await fileRows(release.id)).toHaveLength(1);
  });
});

describe("file routes: roles, ownership and status", () => {
  type Send = (
    releaseId: string,
    fileId: string,
    user?: StaffUser,
  ) => request.Test;
  const routes: [string, Send][] = [
    [
      "upload",
      (releaseId, _fileId, user) => {
        const req = request(app).post(`/api/releases/${releaseId}/uploads`);
        return (user ? req.set(user.cookie) : req).send({
          name: "a.pdf",
          size: 1,
          sha256: sha256(Buffer.from("x")),
          kind: "DOC",
        });
      },
    ],
    [
      "delete",
      (releaseId, fileId, user) => {
        const req = request(app).delete(
          `/api/releases/${releaseId}/files/${fileId}`,
        );
        return user ? req.set(user.cookie) : req;
      },
    ],
  ];

  for (const [name, send] of routes) {
    it(`${name} is for the creating DEV only`, async () => {
      const release = await draft({ files: [{ kind: "DOC" }] });
      const [file] = await fileRows(release.id);

      expect((await send(release.id, file.id)).status).toBe(401);
      for (const user of [customer, admin]) {
        const res = await send(release.id, file.id, user);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
      }
      const other = await send(release.id, file.id, otherDev);
      expect(other.status).toBe(403);
      expect(other.body.code).toBe("NOT_RELEASE_OWNER");

      const rows = await fileRows(release.id);
      expect(rows).toEqual([file]);
    });

    it(`${name} is locked in review and after publishing`, async () => {
      for (const status of ["IN_REVIEW", "PUBLISHED"] as const) {
        const release = await draft({ status, files: [{ kind: "DOC" }] });
        const [file] = await fileRows(release.id);

        const res = await send(release.id, file.id, dev);

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("RELEASE_LOCKED");
        expect(await fileRows(release.id)).toEqual([file]);
      }
    });
  }
});

describe("draft to review with real uploads", () => {
  it("uploads two SDKs and a doc, then submits", async () => {
    const release = await draft();
    for (const [fields, name] of [
      [{ kind: "SDK", platform: "WINDOWS" }, "emass-1.0.0.msi"],
      [{ kind: "SDK", platform: "MACOS" }, "emass-1.0.0.dmg"],
      [{ kind: "DOC" }, "guide-1.0.0.txt"],
    ] as const) {
      const res = await upload(release.id, fields, {
        body: randomBytes(64 * 1024),
        name,
      });
      expect(res.status).toBe(201);
    }

    const submitted = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);

    expect(submitted.status).toBe(200);
    expect(submitted.body.data).toMatchObject({
      status: "IN_REVIEW",
      fileCount: 3,
    });
  });
});

describe("file rules on upload, read and submit", () => {
  // Each test gets its own installer bytes (all say 2.5.0 inside): once a
  // test ships one, the same bytes are rightly blocked everywhere else
  let installers = 0;
  const freshExe = () => buildPe({ paddingBefore: ++installers * 512 });

  it("blocks an installer identical to another release's file and keeps nothing", async () => {
    const exe = freshExe();
    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.4.0",
      status: "PUBLISHED",
      files: [{ name: "emass-win.exe", sha256: sha256(exe) }],
    });
    const release = await draft({ productId: product.id, version: "2.5.0" });

    const res = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS" },
      { body: exe, name: "setup.exe" },
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "FILE_BLOCKED",
      message: 'Identical to "emass-win.exe" in v2.4.0.',
    });
    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("blocks an installer that says another version, after reading it from storage", async () => {
    const exe = freshExe();
    const release = await draft({ version: "2.6.0" });

    const res = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS" },
      { body: exe, name: "setup.exe" },
    );

    expect(res.status).toBe(409);
    expect(res.body.details.reasons).toEqual([
      expect.objectContaining({
        code: "VERSION_MISMATCH",
        version: "2.5.0",
        expected: "2.6.0",
      }),
    ]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("requires the SHA-256 the browser computed", async () => {
    const release = await draft();

    const res = await upload(
      release.id,
      { kind: "DOC", sha256: "" },
      { body: randomBytes(64), name: "notes.txt" },
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain("SHA-256 is required");
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("refuses bytes that don't match the declared SHA-256", async () => {
    const exe = freshExe();
    const release = await draft({ version: "2.5.0" });

    const res = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS", sha256: sha256(randomBytes(10)) },
      { body: exe, name: "setup.exe" },
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CHECKSUM_MISMATCH");
    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("stores what inspection found when the declared SHA-256 matches", async () => {
    const exe = freshExe();
    const release = await draft({ version: "2.5.0" });

    const res = await upload(
      release.id,
      { kind: "SDK", platform: "WINDOWS", sha256: sha256(exe).toUpperCase() },
      { body: exe, name: "setup.exe" },
    );

    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({
      format: "PE",
      detectedVersions: ["2.5.0"],
      blockedBy: [],
      warnings: [],
    });
    const [row] = await fileRows(release.id);
    expect(row).toMatchObject({ format: "PE", detectedVersions: ["2.5.0"] });
  });

  it("allows a doc of another version, with a warning on upload and on read", async () => {
    const release = await draft({ version: "2.5.0" });
    const pdf = buildPdfDocument({ info: "/Subject(EMASS IDE Version 1.4)" });

    const res = await upload(
      release.id,
      { kind: "DOC" },
      { body: pdf, name: "User-Guide.pdf" },
    );

    expect(res.status).toBe(201);
    const warning = {
      code: "DOC_VERSION_MISMATCH",
      message:
        "This file says version 1.4.0 (Info Subject); this release is 2.5.0.",
      version: "1.4.0",
      fields: ["Info Subject"],
      expected: "2.5.0",
    };
    expect(res.body.data.file.warnings).toEqual([warning]);

    const detail = await request(app)
      .get(`/api/releases/${release.id}`)
      .set(dev.cookie);
    // Stored files keep only the versions, so the fields are gone on read
    expect(detail.body.data.files[0].warnings).toEqual([
      {
        ...warning,
        message: "This file says version 1.4.0; this release is 2.5.0.",
        fields: [],
      },
    ]);
  });

  it("re-judges installers after a version change, and submit refuses them", async () => {
    const exe = freshExe();
    const release = await draft({ version: "2.5.0" });
    expect(
      (
        await upload(
          release.id,
          { kind: "SDK", platform: "WINDOWS" },
          { body: exe, name: "setup.exe" },
        )
      ).status,
    ).toBe(201);

    await request(app)
      .patch(`/api/releases/${release.id}`)
      .set(dev.cookie)
      .send({ version: "2.6.0" })
      .expect(200);
    const detail = await request(app)
      .get(`/api/releases/${release.id}`)
      .set(dev.cookie);
    expect(detail.body.data.files[0].blockedBy).toEqual([
      {
        code: "VERSION_MISMATCH",
        message: "This installer says version 2.5.0; this release is 2.6.0.",
        version: "2.5.0",
        fields: [],
        expected: "2.6.0",
      },
    ]);

    const submitted = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie)
      .send({ confirmWarnings: true });
    expect(submitted.status).toBe(409);
    expect(submitted.body).toMatchObject({
      code: "FILE_BLOCKED",
      details: {
        files: [
          {
            name: "setup.exe",
            reasons: [expect.objectContaining({ code: "VERSION_MISMATCH" })],
          },
        ],
      },
    });
  });

  it("asks submit to confirm warnings, then records them on the event", async () => {
    const release = await draft({ version: "2.5.0" });
    expect(
      (
        await upload(
          release.id,
          { kind: "DOC" },
          { body: randomBytes(512), name: "notes.txt" },
        )
      ).status,
    ).toBe(201);
    const submit = (body: object) =>
      request(app)
        .post(`/api/releases/${release.id}/submit`)
        .set(dev.cookie)
        .send(body);

    const unconfirmed = await submit({});
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body).toMatchObject({
      code: "FILE_WARNINGS_UNCONFIRMED",
      details: {
        files: [
          {
            name: "notes.txt",
            warnings: [expect.objectContaining({ code: "NO_VERSION" })],
          },
        ],
      },
    });
    expect((await submit({ confirmWarnings: "yes" })).status).toBe(400);

    const confirmed = await submit({ confirmWarnings: true });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.status).toBe("IN_REVIEW");
    const event = await prisma.releaseEvent.findFirstOrThrow({
      where: { releaseId: release.id, type: "SUBMITTED" },
    });
    expect(event.note).toBe(
      "Submitted with warnings: notes.txt: No version found in this file's name or contents.",
    );
  });

  it("submits without a note when nothing warns", async () => {
    const exe = freshExe();
    const release = await draft({ version: "2.5.0" });
    expect(
      (
        await upload(
          release.id,
          { kind: "SDK", platform: "WINDOWS" },
          { body: exe, name: "setup.exe" },
        )
      ).status,
    ).toBe(201);

    await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie)
      .expect(200);
    const event = await prisma.releaseEvent.findFirstOrThrow({
      where: { releaseId: release.id, type: "SUBMITTED" },
    });
    expect(event.note).toBeNull();
  });

  it("inspects a file uploaded before inspection existed, once, from storage", async () => {
    const release = await draft({
      version: "1.0.0",
      withObjects: true,
      files: [{ kind: "DOC", name: "guide-9.9.9.zip", format: null }],
    });

    const detail = await request(app)
      .get(`/api/releases/${release.id}`)
      .set(dev.cookie);

    expect(detail.body.data.files[0]).toMatchObject({
      format: "OTHER",
      detectedVersions: ["9.9.9"],
      warnings: [expect.objectContaining({ code: "DOC_VERSION_MISMATCH" })],
    });
    const [row] = await fileRows(release.id);
    expect(row).toMatchObject({ format: "OTHER", detectedVersions: ["9.9.9"] });
  });

  it("doesn't judge shipped releases", async () => {
    const product = await createProduct();
    const shipped = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "3.0.0",
      status: "PUBLISHED",
      files: [{ detectedVersions: ["2.0.0"], format: "PE" }],
    });

    const detail = await request(app)
      .get(`/api/releases/${shipped.id}`)
      .set(dev.cookie);

    expect(detail.body.data.files[0]).toMatchObject({
      blockedBy: [],
      warnings: [],
    });
  });
});
