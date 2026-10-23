import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReleaseStatus } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { env } from "../../src/configs/env.js";
import { logger } from "../../src/configs/logger.js";
import { prisma } from "../../src/configs/prisma.js";
import { getStorageBuckets } from "../../src/configs/storage.js";
import { resetPublishJobs } from "../../src/services/releases/publish.service.js";
import {
  getStorageDriver,
  type CopyObjectInput,
} from "../../src/services/storage/drivers/storage.driver.js";
import { ApiError } from "../../src/utils/api-error.utils.js";
import { resetDb } from "../helpers/resetDb.js";
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
let admin: StaffUser;
let customer: StaffUser;

beforeAll(async () => {
  await resetDb();
  dev = await createDev();
  admin = await createAdmin();
  customer = await createCustomer();
});

afterEach(() => {
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

const publish = (id: string, user: StaffUser = admin) =>
  request(app).post(`/api/releases/${id}/publish`).set(user.cookie);

const status = (id: string, user: StaffUser = admin) =>
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

async function inReview(
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
    status: options.status ?? "IN_REVIEW",
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
  path.resolve(env.STORAGE_LOCAL_DIR, getStorageBuckets().release, key);

describe("POST /api/releases/:id/publish", () => {
  it("copies the files to releases/, publishes, and removes the staged copies", async () => {
    const release = await inReview();
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
      const uuid = before.objectKey.split("/")[3];
      expect(file.objectKey).toBe(
        `releases/${release.productId}/1.0.0/${uuid}/${before.originalName}`,
      );
      expect(await readFile(releaseObjectPath(file.objectKey), "utf8")).toBe(
        `contents of ${before.originalName}`,
      );
      expect(await stagedObjectExists(before.objectKey)).toBe(false);
    }

    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row).toMatchObject({ status: "PUBLISHED", publishedById: admin.id });
    expect(row.publishedAt).toBeInstanceOf(Date);
    const event = await prisma.releaseEvent.findFirst({
      where: { releaseId: release.id, type: "PUBLISHED" },
    });
    expect(event?.actorId).toBe(admin.id);
  });

  it("archives the product's previously published release", async () => {
    const product = await createProduct();
    const previous = await createRelease({
      productId: product.id,
      createdById: dev.id,
      version: "1.0.0",
      status: "PUBLISHED",
    });
    const next = await inReview({ productId: product.id, version: "1.1.0" });

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
      actorId: admin.id,
      note: "Replaced by v1.1.0",
    });
    expect(
      await prisma.release.count({
        where: { productId: product.id, status: "PUBLISHED" },
      }),
    ).toBe(1);
  });

  it("returns the running job to a second click instead of starting another", async () => {
    const release = await inReview();
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
    const release = await inReview();
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
    const release = await inReview();
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
    ).toBe("IN_REVIEW");

    vi.mocked(driver.copyObject).mockRestore();
    await publish(release.id).expect(202);
    expect((await waitForJob(release.id)).phase).toBe("done");
  });

  it("fails and cleans up when changes were requested while copying", async () => {
    const release = await inReview();
    const held = holdCopies();

    await publish(release.id).expect(202);
    await request(app)
      .post(`/api/releases/${release.id}/request-changes`)
      .set(admin.cookie)
      .send({ note: "Wait" })
      .expect(200);
    held.release();
    const job = await waitForJob(release.id);

    expect(job.error?.code).toBe("RELEASE_LOCKED");
    const row = await prisma.release.findUniqueOrThrow({
      where: { id: release.id },
    });
    expect(row.status).toBe("CHANGES_REQUESTED");
    for (const file of await filesOf(release.id)) {
      expect(file.objectKey.startsWith("staged/")).toBe(true);
      expect(await stagedObjectExists(file.objectKey)).toBe(true);
    }
  });

  it("fails when a newer version shipped while copying", async () => {
    const product = await createProduct();
    const release = await inReview({ productId: product.id, version: "1.0.0" });
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
    ).toBe("IN_REVIEW");
  });

  it("stays published when removing a staged copy fails afterwards", async () => {
    const errors = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    const release = await inReview();
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
        "Staged object left behind after publish",
      ),
    );
  });

  it("refuses up front, without a job, when the release isn't ready", async () => {
    const cases: [Parameters<typeof inReview>[0], number, string][] = [
      [{ status: "DRAFT" }, 409, "RELEASE_LOCKED"],
      [{ files: [] }, 400, "NO_FILES"],
      [{ files: [{ kind: null, platform: null }] }, 400, "FILE_TYPE_MISSING"],
      [
        { files: [{ kind: "SDK", platform: null }] },
        400,
        "SDK_PLATFORM_MISSING",
      ],
    ];

    for (const [options, code, errorCode] of cases) {
      const release = await inReview(options);
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
    const older = await inReview({ productId: product.id, version: "2.0.0" });
    const res = await publish(older.id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("VERSION_NOT_NEWER");
  });

  it("is for admins only", async () => {
    const release = await inReview();

    expect(
      (await request(app).post(`/api/releases/${release.id}/publish`)).status,
    ).toBe(401);
    for (const user of [dev, customer]) {
      expect((await publish(release.id, user)).status).toBe(403);
      expect((await status(release.id, user)).status).toBe(403);
    }
  });
});

describe("GET /api/releases/:id/publish-status", () => {
  it("falls back to the release status when no job is known (e.g. after a restart)", async () => {
    const waiting = await inReview();
    const res = await status(waiting.id);
    expect(res.body.data).toEqual({ job: null, status: "IN_REVIEW" });

    const published = await inReview();
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
