import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReleaseStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { logger } from "../../src/configs/logger.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBucket } from "../../src/configs/storage.js";
import { emailWorker } from "../../src/services/email/email-worker.js";
import { emailService } from "../../src/services/email/email.service.js";
import { resetPublishJobs } from "../../src/services/releases/publish.service.js";
import {
  getStorageDriver,
  type CopyObjectInput,
} from "../../src/services/storage/drivers/storage.driver.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { resetDb } from "../helpers/resetDb.js";
import { completeUpload, createUpload } from "../helpers/uploads.js";
import {
  createAdmin,
  createCustomer,
  createDev,
  createProduct,
  createRelease,
  stagedObjectExists,
  type StaffUser,
  type TestFile,
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

afterEach(async () => {
  // Announcements are sent after the publish; finish them first
  await emailWorker.settled();
  vi.restoreAllMocks();
  resetPublishJobs();
});

type Job = {
  phase: string;
  filesTotal: number;
  filesDone: number;
  percent: number;
  error: { code: string; message: string } | null;
};

const publish = (id: string, user: StaffUser = dev) =>
  request(app).post(`/api/releases/${id}/publish`).set(user.cookie);

const status = (id: string, user: StaffUser = dev) =>
  request(app).get(`/api/releases/${id}/publish-status`).set(user.cookie);

/** Polls publish-status until the job settles. */
async function waitForJob(id: string): Promise<Job> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = (await status(id)).body.data.job as Job | null;
    if (job && (job.phase === "done" || job.phase === "failed")) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("publish job did not settle");
}

/** Holds every copy until `release()` is called, then copies for real. */
function holdCopies() {
  const driver = getStorageDriver();
  const original = driver.copyObject.bind(driver);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const spy = vi
    .spyOn(driver, "copyObject")
    .mockImplementation(async (input: CopyObjectInput) => {
      input.onProgress?.(50);
      await gate;
      return original(input);
    });
  return { release, spy };
}

async function aDraft(
  options: {
    version?: string;
    files?: TestFile[];
    productId?: string;
    status?: ReleaseStatus;
  } = {},
) {
  const productId = options.productId ?? (await createProduct()).id;
  return createRelease({
    productId,
    createdById: dev.id,
    version: options.version ?? "1.0.0",
    status: options.status ?? "DRAFT",
    withObjects: true,
    files: options.files ?? [
      { platform: "WINDOWS", name: "emass.msi" },
      { kind: "DOC", name: "guide.pdf" },
    ],
  });
}

const filesOf = (releaseId: string) =>
  prisma.releaseFile.findMany({
    where: { releaseId },
    orderBy: { originalName: "asc" },
  });

const releaseObjectPath = (key: string) =>
  path.resolve(env.STORAGE_LOCAL_DIR, getStorageBucket(), key);

describe("POST /api/releases/:id/publish", () => {
  it("copies the files to publish/, publishes, and removes the draft copies", async () => {
    const release = await aDraft();
    const staged = await filesOf(release.id);

    const res = await publish(release.id);

    expect(res.status).toBe(202);
    expect(res.body.data.job).toMatchObject({
      phase: "copying",
      filesTotal: 2,
      filesDone: 0,
    });
    expect(await waitForJob(release.id)).toMatchObject({
      phase: "done",
      filesDone: 2,
      percent: 100,
      error: null,
    });

    const published = await filesOf(release.id);
    for (const [index, file] of published.entries()) {
      const before = staged[index];
      // draft/{uuid}/{name}
      const uuid = before.objectKey.split("/")[1];
      expect(file.objectKey).toBe(
        `publish/${release.productId}/1.0.0/${uuid}/${before.originalName}`,
      );
      expect(await readFile(releaseObjectPath(file.objectKey), "utf8")).toBe(
        `contents of ${before.originalName}`,
      );
      expect(await stagedObjectExists(before.objectKey)).toBe(false);
    }

    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row).toMatchObject({ status: "PUBLISHED", publishedById: dev.id });
    expect(row.publishedAt).toBeInstanceOf(Date);
    const event = await prisma.releaseEvent.findFirst({
      where: { releaseId: release.id, type: "PUBLISHED" },
    });
    expect(event?.actorId).toBe(dev.id);
  });

  it("announces the new version to everyone who downloaded the product", async () => {
    const announce = vi
      .spyOn(emailService, "sendReleaseAnnouncedEmail")
      .mockResolvedValue();
    const product = await createProduct();
    const previous = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.0.0",
      status: "PUBLISHED",
    });
    await prisma.download.createMany({
      data: [
        { userId: customer.id, releaseId: previous.id },
        { userId: customer.id, releaseId: previous.id },
      ],
    });
    const next = await aDraft({ productId: product.id, version: "1.1.0" });

    await publish(next.id).expect(202);
    await waitForJob(next.id);
    await vi.waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
    await emailWorker.settled();

    expect(announce.mock.calls[0][2]).toEqual({
      productName: product.name,
      version: "1.1.0",
      url: expect.stringMatching(new RegExp(`/catalog/${product.id}$`)),
    });
    const notified = await prisma.releaseEvent.findFirst({
      where: { releaseId: next.id, type: "CUSTOMERS_NOTIFIED" },
    });
    expect(notified).toMatchObject({
      actorId: dev.id,
      note: "Announced v1.1.0 to 1 customer.",
    });
  });

  it("archives the product's previously published release", async () => {
    const product = await createProduct();
    const previous = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.0.0",
      status: "PUBLISHED",
    });
    const next = await aDraft({ productId: product.id, version: "1.1.0" });

    await publish(next.id).expect(202);
    await waitForJob(next.id);

    const previousRow = await prisma.release.findUniqueOrThrow({
      where: { id: previous.id },
    });
    expect(previousRow.status).toBe("ARCHIVED");
    const archived = await prisma.releaseEvent.findFirst({
      where: { releaseId: previous.id, type: "ARCHIVED" },
    });
    expect(archived).toMatchObject({
      actorId: dev.id,
      note: "Replaced by v1.1.0",
    });
    expect(
      await prisma.release.count({
        where: { productId: product.id, status: "PUBLISHED" },
      }),
    ).toBe(1);
  });

  it("returns the running job to a second click instead of starting another", async () => {
    const release = await aDraft();
    const held = holdCopies();

    await publish(release.id).expect(202);
    const second = await publish(release.id);

    expect(second.status).toBe(202);
    expect(second.body.data.job.phase).toBe("copying");
    held.release();
    expect((await waitForJob(release.id)).phase).toBe("done");
    expect(held.spy).toHaveBeenCalledTimes(2);
    expect(
      await prisma.releaseEvent.count({
        where: { releaseId: release.id, type: "PUBLISHED" },
      }),
    ).toBe(1);
  });

  it("reports progress while copying", async () => {
    const release = await aDraft();
    const held = holdCopies();

    await publish(release.id).expect(202);
    const { job } = (await status(release.id)).body.data;

    expect(job).toMatchObject({ phase: "copying", filesDone: 0 });
    expect(job.percent).toBeGreaterThan(0);
    expect(job.percent).toBeLessThan(100);
    held.release();
    await waitForJob(release.id);
  });

  it("undoes everything when a copy fails, and a retry succeeds", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const release = await aDraft();
    const staged = await filesOf(release.id);
    const driver = getStorageDriver();
    const original = driver.copyObject.bind(driver);
    const copied: string[] = [];
    vi.spyOn(driver, "copyObject")
      .mockImplementationOnce(async (input) => {
        copied.push(input.toKey);
        return original(input);
      })
      .mockRejectedValueOnce(
        new ApiError(502, "Unable to copy file", "COPY_FAILED"),
      );

    await publish(release.id).expect(202);
    const job = await waitForJob(release.id);

    expect(job).toMatchObject({
      phase: "failed",
      error: { code: "COPY_FAILED" },
    });
    // The first file's copy is gone again; staged files and rows are untouched
    await expect(readFile(releaseObjectPath(copied[0]))).rejects.toThrow();
    for (const file of staged) {
      expect(await stagedObjectExists(file.objectKey)).toBe(true);
    }
    expect(await filesOf(release.id)).toEqual(staged);
    expect(
      (await prisma.release.findUniqueOrThrow({ where: { id: release.id } }))
        .status,
    ).toBe("DRAFT");

    vi.mocked(driver.copyObject).mockRestore();
    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");
  });

  it("refuses to change the draft while its files are copying", async () => {
    const release = await aDraft();
    const [file] = await filesOf(release.id);
    const held = holdCopies();
    await publish(release.id).expect(202);

    const attempts = [
      request(app)
        .patch(`/api/releases/${release.id}`)
        .set(dev.cookie)
        .send({ releaseNotes: "x" }),
      request(app)
        .delete(`/api/releases/${release.id}/files/${file.id}`)
        .set(dev.cookie),
      request(app).delete(`/api/releases/${release.id}`).set(dev.cookie),
      request(app)
        .post(`/api/releases/${release.id}/uploads`)
        .set(dev.cookie)
        .send({
          name: "late.pdf",
          size: 1,
          sha256: randomBytes(32).toString("hex"),
          kind: "DOC",
        }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RELEASE_PUBLISHING");
    }

    held.release();
    expect((await waitForJob(release.id)).phase).toBe("done");
  });

  it("fails and cleans up when the version changed during the copy", async () => {
    const release = await aDraft();
    const held = holdCopies();
    await publish(release.id).expect(202);

    await prisma.release.update({
      where: { id: release.id },
      data: { version: "1.0.1", versionPatch: 1 },
    });
    held.release();
    const job = await waitForJob(release.id);

    expect(job.error?.code).toBe("RELEASE_CHANGED");
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row.status).toBe("DRAFT");
    for (const file of await filesOf(release.id)) {
      expect(file.objectKey.startsWith("draft/")).toBe(true);
      expect(await stagedObjectExists(file.objectKey)).toBe(true);
    }
  });

  it("fails when a newer version shipped while copying", async () => {
    const product = await createProduct();
    const release = await aDraft({ productId: product.id, version: "1.0.0" });
    const held = holdCopies();

    await publish(release.id).expect(202);
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "2.0.0",
      status: "PUBLISHED",
    });
    held.release();
    const job = await waitForJob(release.id);

    expect(job.error?.code).toBe("VERSION_NOT_NEWER");
    expect(
      (await prisma.release.findUniqueOrThrow({ where: { id: release.id } }))
        .status,
    ).toBe("DRAFT");
  });

  it("stays published when removing a draft copy fails afterwards", async () => {
    const errors = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const release = await aDraft();
    vi.spyOn(getStorageDriver(), "deleteObject").mockRejectedValue(
      new ApiError(502, "Unable to delete file", "DELETE_FAILED"),
    );

    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");

    expect(
      (await prisma.release.findUniqueOrThrow({ where: { id: release.id } }))
        .status,
    ).toBe("PUBLISHED");
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({ releaseId: release.id }),
        "Draft object left behind after publish",
      ),
    );
  });

  it("refuses up front, without a job, when the release isn't ready", async () => {
    const cases: [Parameters<typeof aDraft>[0], number, string][] = [
      [{ status: "PUBLISHED" }, 409, "RELEASE_LOCKED"],
      [{ files: [] }, 400, "NO_FILES"],
      [{ files: [{ kind: null, platform: null }] }, 400, "FILE_TYPE_MISSING"],
      [
        { files: [{ kind: "SDK", platform: null }] },
        400,
        "SDK_PLATFORM_MISSING",
      ],
    ];

    for (const [options, code, errorCode] of cases) {
      const release = await aDraft(options);
      const res = await publish(release.id);
      expect(res.status, errorCode).toBe(code);
      expect(res.body.code).toBe(errorCode);
      expect((await status(release.id)).body.data.job).toBeNull();
    }

    const product = await createProduct();
    await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "3.0.0",
      status: "ARCHIVED",
    });
    const older = await aDraft({ productId: product.id, version: "2.0.0" });
    const res = await publish(older.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VERSION_NOT_NEWER");
  });

  it("lets any developer publish, not only the one who created it", async () => {
    const release = await aDraft();

    await publish(release.id, otherDev).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");

    expect(
      await prisma.release.findUniqueOrThrow({ where: { id: release.id } }),
    ).toMatchObject({
      status: "PUBLISHED",
      createdById: dev.id,
      publishedById: otherDev.id,
    });
  });

  it("publishes a draft stored under the older staged/ prefix", async () => {
    const release = await aDraft({ files: [] });
    const key = `staged/${randomUUID()}/old.zip`;
    await getStorageDriver().putStream({
      bucket: getStorageBucket(),
      key,
      body: (async function* () {
        yield Buffer.from("old bytes");
      })(),
    });
    await prisma.releaseFile.create({
      data: {
        releaseId: release.id,
        kind: "DOC",
        originalName: "old-1.0.0.zip",
        contentType: "application/zip",
        sizeBytes: 9n,
        sha256: randomBytes(32).toString("hex"),
        objectKey: key,
        format: "OTHER",
        detectedVersions: ["1.0.0"],
      },
    });

    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");

    const [file] = await filesOf(release.id);
    expect(file.objectKey.startsWith(`publish/${release.productId}/`)).toBe(
      true,
    );
    expect(await stagedObjectExists(key)).toBe(false);
  });

  it("is for developers only", async () => {
    const release = await aDraft();

    expect(
      (await request(app).post(`/api/releases/${release.id}/publish`)).status,
    ).toBe(401);
    for (const user of [admin, customer]) {
      expect((await publish(release.id, user)).status).toBe(403);
      expect((await status(release.id, user)).status).toBe(403);
    }
  });
});

describe("publishing with unfinished uploads", () => {
  const open = async (releaseId: string) => {
    const file = { body: randomBytes(64), name: "late.pdf" };
    const res = await createUpload(releaseId, otherDev.cookie, file, {
      kind: "DOC",
    });
    expect(res.status).toBeLessThan(300);
    return res.body.data.uploadId as string;
  };

  it("refuses while an upload is open, saying which and whose", async () => {
    const release = await aDraft();
    const uploadId = await open(release.id);

    const res = await publish(release.id);

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "UPLOADS_IN_PROGRESS",
      details: {
        uploads: [
          {
            uploadId,
            name: "late.pdf",
            startedBy: expect.stringContaining("Omar"),
          },
        ],
      },
    });
    expect((await status(release.id)).body.data.job).toBeNull();
  });

  it("publishes once the upload is cancelled, by any developer", async () => {
    const release = await aDraft();
    const uploadId = await open(release.id);

    await request(app)
      .delete(`/api/releases/${release.id}/uploads/${uploadId}`)
      .set(dev.cookie)
      .expect(200);

    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");
  });

  it("isn't held back by an upload abandoned for over 24 hours", async () => {
    const release = await aDraft();
    await open(release.id);
    await prisma.uploadSession.updateMany({
      where: { releaseId: release.id },
      data: { updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });

    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");
    expect(
      await prisma.uploadSession.count({ where: { releaseId: release.id } }),
    ).toBe(0);
  });

  it("refuses to complete an upload while the draft is publishing", async () => {
    const release = await aDraft();
    const held = holdCopies();
    await publish(release.id).expect(202);
    const session = await prisma.uploadSession.create({
      data: {
        releaseId: release.id,
        createdById: dev.id,
        objectKey: `draft/${randomUUID()}/late.pdf`,
        storageUploadId: "u",
        fileName: "late.pdf",
        contentType: "application/pdf",
        sizeBytes: 1n,
        partSize: 1,
        hashState: new Uint8Array(1),
        declaredSha256: randomBytes(32).toString("hex"),
      },
    });

    const res = await completeUpload(release.id, dev.cookie, session.id);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RELEASE_PUBLISHING");
    held.release();
    await waitForJob(release.id);
  });

  it("fails when a file's platform changed during the copy", async () => {
    const release = await aDraft();
    const held = holdCopies();
    await publish(release.id).expect(202);

    await prisma.releaseFile.updateMany({
      where: { releaseId: release.id, kind: "SDK" },
      data: { platform: "MACOS" },
    });
    held.release();

    expect((await waitForJob(release.id)).error?.code).toBe("RELEASE_CHANGED");
  });
});

describe("GET /api/releases/:id/publish-status", () => {
  it("falls back to the release status when no job is known (e.g. after a restart)", async () => {
    const waiting = await aDraft();
    const res = await status(waiting.id);
    expect(res.body.data).toEqual({ job: null, status: "DRAFT" });

    const published = await aDraft();
    await publish(published.id).expect(202);
    await waitForJob(published.id);
    resetPublishJobs();

    expect((await status(published.id)).body.data).toEqual({
      job: null,
      status: "PUBLISHED",
    });
  });

  it("answers 404 for an unknown release", async () => {
    const res = await status("9f0f9b4e-6f6a-4a3c-9a3c-2f5b8e1d0c11");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/releases/publish-jobs", () => {
  const jobs = (user: StaffUser = dev) =>
    request(app).get("/api/releases/publish-jobs").set(user.cookie);
  const originalTtl = env.PUBLISH_JOB_TTL_MS;
  afterEach(() => {
    env.PUBLISH_JOB_TTL_MS = originalTtl;
  });

  it("is for developers only", async () => {
    expect((await request(app).get("/api/releases/publish-jobs")).status).toBe(
      401,
    );
    for (const user of [admin, customer]) {
      const res = await jobs(user);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("FORBIDDEN");
    }
  });

  it("lists a running job with its release's label", async () => {
    const release = await aDraft({ version: "7.1.0" });
    const held = holdCopies();
    await publish(release.id).expect(202);

    const res = await jobs();

    expect(res.status).toBe(200);
    expect(res.body.data.jobs).toEqual([
      {
        releaseId: release.id,
        version: "7.1.0",
        productName: expect.any(String),
        job: expect.objectContaining({ phase: "copying" }),
      },
    ]);
    held.release();
    await waitForJob(release.id);
  });

  it("keeps a settled job for a while, then drops it", async () => {
    env.PUBLISH_JOB_TTL_MS = 100;
    const release = await aDraft({ version: "7.2.0" });
    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");

    const settled = (await jobs()).body.data.jobs;
    expect(settled).toEqual([
      expect.objectContaining({
        releaseId: release.id,
        job: expect.objectContaining({ phase: "done" }),
      }),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await jobs()).body.data.jobs).toEqual([]);
  });

  it("is empty when nothing is publishing", async () => {
    expect((await jobs()).body.data).toEqual({ jobs: [] });
  });
});
