import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

let dev: StaffUser;
let otherDev: StaffUser;
let admin: StaffUser;
let customer: StaffUser;
let server: http.Server;
let port: number;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  otherDev = await createDev("Omar");
  admin = await createAdmin();
  customer = await createCustomer();
  server = app.listen(0);
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((done) => server.close(() => done())));

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

function upload(
  releaseId: string,
  fields: Record<string, string>,
  file: { body: Buffer; name: string; type?: string },
  user: StaffUser = dev,
) {
  let req = request(app)
    .post(`/api/releases/${releaseId}/files`)
    .set(user.cookie);
  for (const [name, value] of Object.entries(fields)) {
    req = req.field(name, value);
  }
  return req.attach("file", file.body, {
    filename: file.name,
    contentType: file.type ?? "application/octet-stream",
  });
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

// --- raw multipart over a real socket (aborts, pauses, bogus lengths) ---

const BOUNDARY = "----emass-test-boundary";

function multipartHead(fields: Record<string, string>, filename: string) {
  const parts = Object.entries(fields).map(
    ([name, value]) =>
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
  parts.push(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  return Buffer.from(parts.join(""));
}

const multipartTail = Buffer.from(`\r\n--${BOUNDARY}--\r\n`);

interface RawResponse {
  status: number;
  body: { code?: string };
}

function rawRequest(releaseId: string, contentLength: number) {
  const req = http.request({
    port,
    method: "POST",
    path: `/api/releases/${releaseId}/files`,
    headers: {
      ...dev.cookie,
      "Content-Type": `multipart/form-data; boundary=${BOUNDARY}`,
      "Content-Length": contentLength,
    },
  });
  const response = new Promise<RawResponse>((resolve, reject) => {
    req.on("response", (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }),
      );
    });
    req.on("error", reject);
  });
  return { req, response };
}

/** Polls until `check` passes (server-side cleanup is asynchronous). */
async function eventually(check: () => Promise<void>, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe("POST /api/releases/:id/files", () => {
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
    const body = Buffer.from("%PDF-1.7 guide");

    const res = await upload(
      release.id,
      { kind: "DOC" },
      { body, name: "../My Guide (v2).pdf", type: "application/pdf" },
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

  it("needs the fields before the file", async () => {
    const release = await draft();

    // A kind sent after the file arrives too late to count
    const lateKind = await request(app)
      .post(`/api/releases/${release.id}/files`)
      .set(dev.cookie)
      .attach("file", Buffer.from("x"), "a.bin")
      .field("kind", "DOC");
    expect(lateKind.status).toBe(400);
    expect(lateKind.body.code).toBe("FIELDS_AFTER_FILE");

    const trailing = await request(app)
      .post(`/api/releases/${release.id}/files`)
      .set(dev.cookie)
      .field("kind", "DOC")
      .attach("file", Buffer.from("x"), "a.bin")
      .field("note", "late");
    expect(trailing.status).toBe(400);
    expect(trailing.body.code).toBe("FIELDS_AFTER_FILE");

    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("rejects non-multipart bodies, missing files, extra files and empty files", async () => {
    const release = await draft();

    const json = await request(app)
      .post(`/api/releases/${release.id}/files`)
      .set(dev.cookie)
      .send({ kind: "DOC" });
    expect(json.status).toBe(415);
    expect(json.body.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const noFile = await request(app)
      .post(`/api/releases/${release.id}/files`)
      .set(dev.cookie)
      .field("kind", "DOC");
    expect(noFile.status).toBe(400);
    expect(noFile.body.code).toBe("FILE_MISSING");

    const twoFiles = await request(app)
      .post(`/api/releases/${release.id}/files`)
      .set(dev.cookie)
      .field("kind", "DOC")
      .attach("file", Buffer.from("one"), "one.pdf")
      .attach("second", Buffer.from("two"), "two.pdf");
    expect(twoFiles.status).toBe(400);
    expect(twoFiles.body.code).toBe("TOO_MANY_FILES");

    const empty = await upload(
      release.id,
      { kind: "DOC" },
      { body: Buffer.alloc(0), name: "empty.pdf" },
    );
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe("EMPTY_FILE");

    expect(await fileRows(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  describe("size cap", () => {
    const original = env.MAX_UPLOAD_BYTES;
    afterEach(() => {
      env.MAX_UPLOAD_BYTES = original;
    });

    it("stops a file that streams past the cap and leaves nothing behind", async () => {
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

    it("refuses an oversized request from its Content-Length before reading it", async () => {
      const release = await draft();
      const { req, response } = rawRequest(release.id, 2 * 1024 ** 3);
      req.flushHeaders();

      const res = await response;
      req.destroy();

      expect(res.status).toBe(413);
      expect(res.body.code).toBe("FILE_TOO_LARGE");
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
    vi.spyOn(getStorageDriver(), "putStream").mockRejectedValueOnce(
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

  it("leaves nothing behind when the client disconnects mid-upload", async () => {
    const release = await draft();
    const head = multipartHead({ kind: "SDK", platform: "WINDOWS" }, "a.msi");
    const fileBytes = 4 * 1024 ** 2;
    const { req, response } = rawRequest(
      release.id,
      head.length + fileBytes + multipartTail.length,
    );
    response.catch(() => undefined);

    req.write(head);
    req.write(randomBytes(1024 ** 2));
    await new Promise((resolve) => setTimeout(resolve, 200));
    req.destroy();

    await eventually(async () => {
      expect(await fileRows(release.id)).toEqual([]);
      expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
    });
  });

  it("refuses an upload that finishes after the release was submitted", async () => {
    const release = await draft({ files: [{ platform: "MACOS" }] });
    const head = multipartHead(
      { kind: "SDK", platform: "WINDOWS" },
      "late.msi",
    );
    const half = randomBytes(512 * 1024);
    const { req, response } = rawRequest(
      release.id,
      head.length + half.length * 2 + multipartTail.length,
    );

    req.write(head);
    req.write(half);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const submitted = await request(app)
      .post(`/api/releases/${release.id}/submit`)
      .set(dev.cookie);
    expect(submitted.status).toBe(200);

    req.write(half);
    req.end(multipartTail);
    const res = await response;

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
        const req = request(app).post(`/api/releases/${releaseId}/files`);
        return (user ? req.set(user.cookie) : req)
          .field("kind", "DOC")
          .attach("file", Buffer.from("x"), "a.pdf");
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
      [{ kind: "SDK", platform: "WINDOWS" }, "emass.msi"],
      [{ kind: "SDK", platform: "MACOS" }, "emass.dmg"],
      [{ kind: "DOC" }, "guide.pdf"],
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
