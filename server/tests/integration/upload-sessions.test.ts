import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBuckets } from "../../src/configs/storage.js";
import { getStorageDriver } from "../../src/services/storage/drivers/storage.driver.js";
import { buildPe } from "../helpers/file-fixtures.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  stagedFilesFor,
  type StaffUser,
} from "../helpers/releases.js";
import { resetDb } from "../helpers/resetDb.js";
import {
  completeUpload,
  createUpload,
  partOf,
  putPart,
  sha256,
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

// Small parts so a few KB make a multi-part file; set before each create
const PART = 1024;
const originalPartSize = env.UPLOAD_PART_BYTES;
afterEach(() => {
  env.UPLOAD_PART_BYTES = originalPartSize;
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

/** A DOC upload of `size` random bytes, opened with small parts. */
async function opened(releaseId: string, size = 2.5 * PART) {
  env.UPLOAD_PART_BYTES = PART;
  const file = { body: randomBytes(size), name: "guide.txt" };
  const res = await createUpload(releaseId, dev.cookie, file, { kind: "DOC" });
  expect(res.status).toBe(200);
  return { file, uploadId: res.body.data.uploadId as string };
}

const sessions = (releaseId: string) =>
  prisma.uploadSession.findMany({ where: { releaseId } });

async function stagedBytes(objectKey: string): Promise<Buffer> {
  const { staging } = getStorageBuckets();
  return readFile(path.resolve(env.STORAGE_LOCAL_DIR, staging, objectKey));
}

describe("POST /api/releases/:id/uploads", () => {
  it("opens a session, and the same bytes again return it", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);

    const again = await createUpload(release.id, dev.cookie, file, {
      kind: "DOC",
    });

    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({
      uploadId,
      name: "guide.txt",
      size: file.body.length,
      sha256: sha256(file.body),
      partSize: PART,
      partsDone: 0,
    });
    expect(await sessions(release.id)).toHaveLength(1);
  });

  it("refuses the same bytes with other details while their upload is open", async () => {
    const release = await draft();
    const { file } = await opened(release.id);

    const res = await createUpload(
      release.id,
      dev.cookie,
      { ...file, name: "renamed.txt" },
      { kind: "DOC" },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("UPLOAD_SESSION_MISMATCH");
  });

  it("refuses bytes this release already has, before any part is sent", async () => {
    const release = await draft();
    const body = randomBytes(64);
    const first = await uploadInParts(
      release.id,
      dev.cookie,
      { body, name: "a.txt" },
      { kind: "DOC" },
    );
    expect(first.status).toBe(201);

    const res = await createUpload(
      release.id,
      dev.cookie,
      { body, name: "b.txt" },
      { kind: "DOC" },
    );

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "FILE_BLOCKED",
      message: 'Already in this release as "a.txt".',
    });
    expect(await sessions(release.id)).toEqual([]);
  });

  it("validates the body, with missing and wrong-type messages", async () => {
    const release = await draft();
    const res = await request(app)
      .post(`/api/releases/${release.id}/uploads`)
      .set(dev.cookie)
      .send({ size: "big", sha256: "nope" });

    expect(res.status).toBe(400);
    expect(res.body.details.fieldErrors).toMatchObject({
      name: ["Name is required"],
      size: ["Size must be a number"],
      sha256: ["SHA-256 must be 64 hexadecimal characters"],
    });
  });
});

describe("PUT /api/releases/:id/uploads/:uploadId/parts/:n", () => {
  it("takes parts in order, acknowledges repeats and refuses gaps", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);
    const part = (n: number) => partOf(file.body, PART, n);
    const send = (n: number, body = part(n)) =>
      putPart(release.id, dev.cookie, uploadId, n, body);

    expect((await send(1)).body.data.partsDone).toBe(1);
    // A retry after a lost response is fine and changes nothing
    const repeat = await send(1);
    expect(repeat.status).toBe(200);
    expect(repeat.body.data.partsDone).toBe(1);

    const gap = await send(3);
    expect(gap.status).toBe(409);
    expect(gap.body).toMatchObject({
      code: "PART_OUT_OF_ORDER",
      details: { expected: 2 },
    });

    const short = await send(2, part(2).subarray(1));
    expect(short.status).toBe(400);
    expect(short.body).toMatchObject({
      code: "PART_SIZE_INVALID",
      details: { expected: PART },
    });

    const beyond = await send(4, Buffer.alloc(1));
    expect(beyond.status).toBe(400);
    expect(beyond.body.code).toBe("PART_NUMBER_INVALID");

    expect((await send(2)).body.data.partsDone).toBe(2);
    // The last part is what remains: half a part here
    const last = await send(3);
    expect(last.status).toBe(200);
    expect(last.body.data.partsDone).toBe(3);
  });

  it("refuses a body that isn't a raw part", async () => {
    const release = await draft();
    const { uploadId } = await opened(release.id);

    const res = await request(app)
      .put(`/api/releases/${release.id}/uploads/${uploadId}/parts/1`)
      .set(dev.cookie)
      .send({ not: "bytes" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PART_BODY_INVALID");
  });

  it("refuses a part over the part limit without reading it all", async () => {
    const release = await draft();
    const { uploadId } = await opened(release.id);

    const res = await putPart(
      release.id,
      dev.cookie,
      uploadId,
      1,
      Buffer.alloc(originalPartSize + 1),
    );

    expect(res.status).toBe(413);
    expect(res.body.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("stops taking parts once the release is no longer editable", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);
    await prisma.release.update({
      where: { id: release.id },
      data: { status: "IN_REVIEW" },
    });

    const res = await putPart(
      release.id,
      dev.cookie,
      uploadId,
      1,
      partOf(file.body, PART, 1),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RELEASE_LOCKED");
  });
});

describe("POST /api/releases/:id/uploads/:uploadId/complete", () => {
  it("saves the file from its parts and ends the session", async () => {
    const release = await draft();
    env.UPLOAD_PART_BYTES = PART;
    const body = randomBytes(5 * PART + 7);

    const res = await uploadInParts(
      release.id,
      dev.cookie,
      { body, name: "notes.txt", type: "text/plain" },
      { kind: "DOC" },
    );

    expect(res.status).toBe(201);
    expect(res.body.data.file).toMatchObject({
      name: "notes.txt",
      kind: "DOC",
      contentType: "text/plain",
      sizeBytes: body.length,
      sha256: sha256(body),
    });
    const [row] = await prisma.releaseFile.findMany({
      where: { releaseId: release.id },
    });
    expect((await stagedBytes(row.objectKey)).equals(body)).toBe(true);
    expect(await sessions(release.id)).toEqual([]);
  });

  it("refuses to complete before every part has arrived", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);
    await putPart(
      release.id,
      dev.cookie,
      uploadId,
      1,
      partOf(file.body, PART, 1),
    );

    const res = await completeUpload(release.id, dev.cookie, uploadId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "UPLOAD_INCOMPLETE",
      details: { expected: 2 },
    });
  });

  it("discards an upload whose bytes don't match the declared hash", async () => {
    const release = await draft();
    env.UPLOAD_PART_BYTES = PART;

    const res = await uploadInParts(
      release.id,
      dev.cookie,
      { body: randomBytes(3 * PART), name: "guide.txt" },
      { kind: "DOC", sha256: sha256(randomBytes(8)) },
    );

    expect(res.status).toBe(422);
    expect(res.body.code).toBe("CHECKSUM_MISMATCH");
    expect(await sessions(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("deletes a blocked file and ends its session", async () => {
    const release = await draft({ version: "3.0.0" });

    // The installer says 2.5.0 inside
    const res = await uploadInParts(
      release.id,
      dev.cookie,
      { body: buildPe({ paddingBefore: 4096 }), name: "setup.exe" },
      { kind: "SDK", platform: "WINDOWS" },
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FILE_BLOCKED");
    expect(await sessions(release.id)).toEqual([]);
    expect(await stagedFilesFor(release.productId, release.id)).toEqual([]);
  });

  it("says the upload is gone when it is completed twice", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id, PART);
    await putPart(release.id, dev.cookie, uploadId, 1, file.body);
    expect(
      (await completeUpload(release.id, dev.cookie, uploadId)).status,
    ).toBe(201);

    const again = await completeUpload(release.id, dev.cookie, uploadId);

    expect(again.status).toBe(404);
    expect(again.body.code).toBe("UPLOAD_NOT_FOUND");
  });
});

describe("GET and DELETE /api/releases/:id/uploads", () => {
  it("lists open uploads with their progress", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);
    await putPart(
      release.id,
      dev.cookie,
      uploadId,
      1,
      partOf(file.body, PART, 1),
    );

    const res = await request(app)
      .get(`/api/releases/${release.id}/uploads`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.uploads).toEqual([
      expect.objectContaining({ uploadId, partsDone: 1, partSize: PART }),
    ]);
  });

  it("cancels an upload, after which its parts are refused", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);

    const res = await request(app)
      .delete(`/api/releases/${release.id}/uploads/${uploadId}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(await sessions(release.id)).toEqual([]);
    const late = await putPart(
      release.id,
      dev.cookie,
      uploadId,
      1,
      partOf(file.body, PART, 1),
    );
    expect(late.status).toBe(404);
    expect(late.body.code).toBe("UPLOAD_NOT_FOUND");
  });

  it("aborts uploads untouched for over 24 hours", async () => {
    const release = await draft();
    const { uploadId } = await opened(release.id);
    await prisma.$executeRaw`UPDATE "UploadSession" SET "updatedAt" = now() - interval '25 hours' WHERE id = ${uploadId}`;

    const res = await request(app)
      .get(`/api/releases/${release.id}/uploads`)
      .set(dev.cookie);

    expect(res.body.data.uploads).toEqual([]);
    expect(await sessions(release.id)).toEqual([]);
  });

  it("cancels open uploads when the release is deleted", async () => {
    const release = await draft();
    await opened(release.id);

    const res = await request(app)
      .delete(`/api/releases/${release.id}`)
      .set(dev.cookie);

    expect(res.status).toBe(200);
    expect(await sessions(release.id)).toEqual([]);
  });
});

describe("upload routes: roles and ownership", () => {
  it("are for the creating DEV only", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id);
    const base = `/api/releases/${release.id}/uploads`;
    const calls = (user?: StaffUser) => {
      const as = (req: request.Test) => (user ? req.set(user.cookie) : req);
      return [
        as(request(app).post(base)).send({
          name: "x.txt",
          size: 1,
          sha256: sha256(Buffer.from("x")),
        }),
        as(request(app).get(base)),
        as(request(app).put(`${base}/${uploadId}/parts/1`))
          .set("Content-Type", "application/octet-stream")
          .send(partOf(file.body, PART, 1)),
        as(request(app).post(`${base}/${uploadId}/complete`)),
        as(request(app).delete(`${base}/${uploadId}`)),
      ];
    };

    for (const res of await Promise.all(calls())) {
      expect(res.status).toBe(401);
    }
    for (const user of [admin, customer]) {
      for (const res of await Promise.all(calls(user))) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("FORBIDDEN");
      }
    }
    for (const res of await Promise.all(calls(otherDev))) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_RELEASE_OWNER");
    }

    const [session] = await sessions(release.id);
    expect(session).toMatchObject({ id: uploadId, partsDone: 0 });
  });
});

describe("complete commits what storage holds", () => {
  it("survives a part sent twice behind the session's back (the refresh race)", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id, 2 * PART);
    for (const n of [1, 2]) {
      expect(
        (
          await putPart(
            release.id,
            dev.cookie,
            uploadId,
            n,
            partOf(file.body, PART, n),
          )
        ).status,
      ).toBe(200);
    }
    // A second copy of part 1 lands in storage after the session recorded the first
    const session = await prisma.uploadSession.findUniqueOrThrow({
      where: { id: uploadId },
    });
    await getStorageDriver().uploadPart({
      bucket: getStorageBuckets().staging,
      key: session.objectKey,
      uploadId: session.storageUploadId,
      partNum: 1,
      body: Buffer.from(partOf(file.body, PART, 1)),
    });

    const res = await completeUpload(release.id, dev.cookie, uploadId);

    expect(res.status).toBe(201);
    expect(res.body.data.file.sha256).toBe(sha256(file.body));
  });

  it("refuses a part whose bytes aren't what the server received, and ends the session", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id, 2 * PART);
    for (const n of [1, 2])
      await putPart(
        release.id,
        dev.cookie,
        uploadId,
        n,
        partOf(file.body, PART, n),
      );
    const session = await prisma.uploadSession.findUniqueOrThrow({
      where: { id: uploadId },
    });
    await getStorageDriver().uploadPart({
      bucket: getStorageBuckets().staging,
      key: session.objectKey,
      uploadId: session.storageUploadId,
      partNum: 2,
      body: Buffer.alloc(PART, 7),
    });

    const res = await completeUpload(release.id, dev.cookie, uploadId);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "UPLOAD_PARTS_MISMATCH",
      details: { partNum: 2 },
    });
    expect(await sessions(release.id)).toEqual([]);
  });

  it("still completes a session recorded before part checksums were kept", async () => {
    const release = await draft();
    const { file, uploadId } = await opened(release.id, 2 * PART);
    for (const n of [1, 2])
      await putPart(
        release.id,
        dev.cookie,
        uploadId,
        n,
        partOf(file.body, PART, n),
      );
    const session = await prisma.uploadSession.findUniqueOrThrow({
      where: { id: uploadId },
    });
    const plain = Object.fromEntries(
      Object.entries(session.etags as Record<string, { etag: string }>).map(
        ([n, part]) => [n, part.etag],
      ),
    );
    await prisma.uploadSession.update({
      where: { id: uploadId },
      data: { etags: plain },
    });

    expect(
      (await completeUpload(release.id, dev.cookie, uploadId)).status,
    ).toBe(201);
  });
});
