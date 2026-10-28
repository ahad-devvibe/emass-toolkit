import { ReleaseEventType, ReleaseStatus, type Release } from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import {
  getStorageBuckets,
  type StorageBuckets,
} from "../../configs/storage.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  getStorageDriver,
  type StorageDriver,
} from "../storage/drivers/storage.driver.js";
import { releasedKey } from "../storage/storage.utils.js";
import { releaseChanged, releaseNotFound } from "./releases.errors.js";
import {
  assertNewerThanShipped,
  assertReadyForReview,
  lockProductReleases,
  lockRelease,
} from "./releases.service.js";

// Publish copies every file staging → release bucket, which can take minutes
// for large builds, so it runs as a background job the admin dialog polls.
// Jobs live in memory (one VM). The database only changes in the final
// transaction, so a restart mid-job never leaves a half-published release,
// and a retry is safe: released keys are deterministic (same uuid).

export type PublishPhase = "copying" | "finalizing" | "done" | "failed";

export interface PublishJob {
  releaseId: string;
  phase: PublishPhase;
  filesTotal: number;
  filesDone: number;
  /** Size-weighted 0–100 across all files. */
  percent: number;
  error: { code: string; message: string } | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface PublishDeps {
  driver: StorageDriver;
  buckets: () => StorageBuckets;
  now: () => Date;
  ttlMs: number;
}

const defaultDeps = (): PublishDeps => ({
  driver: getStorageDriver(),
  buckets: getStorageBuckets,
  now: () => new Date(),
  ttlMs: env.PUBLISH_JOB_TTL_MS,
});

// Finalize may wait on the product lock behind a rollback or another publish
const FINALIZE_TIMEOUT_MS = 30_000;

const jobs = new Map<string, PublishJob>();
const expiries = new Map<string, NodeJS.Timeout>();

const isRunning = (job: PublishJob) =>
  job.phase === "copying" || job.phase === "finalizing";

/** Forget every job (tests; a restart does the same). */
export function resetPublishJobs(): void {
  for (const timer of expiries.values()) clearTimeout(timer);
  expiries.clear();
  jobs.clear();
}

/**
 * Overall progress: files already copied plus the share of the current one,
 * weighted by size. With nothing but empty files, it counts files instead.
 */
export function weightedPercent(
  sizes: number[],
  filesDone: number,
  currentPercent: number,
): number {
  if (sizes.length === 0) return 100;
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const current = Math.min(100, Math.max(0, currentPercent)) / 100;
  if (total === 0) {
    return Math.floor(((filesDone + current) / sizes.length) * 100);
  }
  const done = sizes.slice(0, filesDone).reduce((sum, size) => sum + size, 0);
  const progress = done + (sizes[filesDone] ?? 0) * current;
  return Math.min(100, Math.floor((progress / total) * 100));
}

function finish(job: PublishJob, deps: PublishDeps): void {
  job.finishedAt = deps.now().toISOString();
  const timer = setTimeout(() => {
    jobs.delete(job.releaseId);
    expiries.delete(job.releaseId);
  }, deps.ttlMs);
  timer.unref?.();
  expiries.set(job.releaseId, timer);
}

function toJobError(error: unknown, releaseId: string): PublishJob["error"] {
  if (error instanceof ApiError) {
    return { code: error.code, message: error.message };
  }
  logger.error({ releaseId, err: error }, "Publish failed unexpectedly");
  return { code: "PUBLISH_FAILED", message: "Publishing failed. Try again." };
}

type FileToPublish = { id: string; objectKey: string; sizeBytes: bigint };
type ReleaseToPublish = Pick<
  Release,
  | "id"
  | "productId"
  | "version"
  | "versionMajor"
  | "versionMinor"
  | "versionPatch"
>;

/**
 * ADMIN: start publishing a release in review. Checks everything it can up
 * front (status, files mapped, version still newer) and throws those as
 * normal 4xx errors; otherwise registers a job, starts it without waiting
 * and returns it. A second call while a job runs returns the same job.
 */
export async function startPublish(
  adminId: string,
  releaseId: string,
  deps: PublishDeps = defaultDeps(),
): Promise<PublishJob> {
  const running = jobs.get(releaseId);
  if (running && isRunning(running)) return { ...running };

  const { release, files } = await prisma.$transaction(async (tx) => {
    const locked = await lockRelease(tx, releaseId, [ReleaseStatus.IN_REVIEW]);
    await assertReadyForReview(tx, locked);
    const rows = await tx.releaseFile.findMany({
      where: { releaseId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, objectKey: true, sizeBytes: true },
    });
    return { release: locked, files: rows };
  });

  // Another request may have started a job while this one was checking
  const raced = jobs.get(releaseId);
  if (raced && isRunning(raced)) return { ...raced };

  clearTimeout(expiries.get(releaseId));
  expiries.delete(releaseId);
  const job: PublishJob = {
    releaseId,
    phase: "copying",
    filesTotal: files.length,
    filesDone: 0,
    percent: 0,
    error: null,
    startedAt: deps.now().toISOString(),
    finishedAt: null,
  };
  jobs.set(releaseId, job);

  void runPublish(job, adminId, release, files, deps).catch((err: unknown) =>
    logger.error({ releaseId, err }, "Publish job crashed"),
  );
  return { ...job };
}

async function runPublish(
  job: PublishJob,
  adminId: string,
  release: ReleaseToPublish,
  files: FileToPublish[],
  deps: PublishDeps,
): Promise<void> {
  const { staging, release: releaseBucket } = deps.buckets();
  const sizes = files.map((file) => Number(file.sizeBytes));
  const copiedKeys: string[] = [];

  try {
    for (const [index, file] of files.entries()) {
      const toKey = releasedKey(file.objectKey, release.version);
      await deps.driver.copyObject({
        fromBucket: staging,
        fromKey: file.objectKey,
        toBucket: releaseBucket,
        toKey,
        onProgress: (percent) => {
          job.percent = weightedPercent(sizes, index, percent);
        },
      });
      copiedKeys.push(toKey);
      job.filesDone = index + 1;
      job.percent = weightedPercent(sizes, index + 1, 0);
    }

    job.phase = "finalizing";
    await prisma.$transaction(
      async (tx) => {
        await lockProductReleases(tx, release.productId);
        await lockRelease(tx, release.id, [ReleaseStatus.IN_REVIEW]);

        // Sent back and resubmitted while copying: the copies may be stale
        const current = await tx.releaseFile.findMany({
          where: { releaseId: release.id },
          select: { id: true, objectKey: true },
        });
        const copied = new Map(files.map((file) => [file.id, file.objectKey]));
        if (
          current.length !== files.length ||
          current.some((file) => copied.get(file.id) !== file.objectKey)
        ) {
          throw releaseChanged();
        }

        // Another release of the product may have shipped meanwhile
        await assertNewerThanShipped(tx, release.productId, {
          major: release.versionMajor,
          minor: release.versionMinor,
          patch: release.versionPatch,
        });

        const previous = await tx.release.findFirst({
          where: {
            productId: release.productId,
            status: ReleaseStatus.PUBLISHED,
          },
          select: { id: true },
        });
        if (previous) {
          await tx.release.update({
            where: { id: previous.id },
            data: { status: ReleaseStatus.ARCHIVED },
          });
          await tx.releaseEvent.create({
            data: {
              releaseId: previous.id,
              type: ReleaseEventType.ARCHIVED,
              actorId: adminId,
              note: `Replaced by v${release.version}`,
            },
          });
        }

        await tx.release.update({
          where: { id: release.id },
          data: {
            status: ReleaseStatus.PUBLISHED,
            publishedAt: deps.now(),
            publishedById: adminId,
          },
        });
        for (const file of files) {
          await tx.releaseFile.update({
            where: { id: file.id },
            data: { objectKey: releasedKey(file.objectKey, release.version) },
          });
        }
        await tx.releaseEvent.create({
          data: {
            releaseId: release.id,
            type: ReleaseEventType.PUBLISHED,
            actorId: adminId,
          },
        });
      },
      { timeout: FINALIZE_TIMEOUT_MS },
    );
  } catch (error) {
    // All or nothing: drop the copies; the database never changed
    const cleanup = await Promise.allSettled(
      copiedKeys.map((key) => deps.driver.deleteObject(releaseBucket, key)),
    );
    cleanup.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(
          { releaseId: release.id, key: copiedKeys[index], err: result.reason },
          "Orphaned released copy after a failed publish",
        );
      }
    });
    job.phase = "failed";
    job.error = toJobError(error, release.id);
    finish(job, deps);
    return;
  }

  job.phase = "done";
  job.percent = 100;
  finish(job, deps);

  // Published: the staged copies are no longer needed (and never served)
  const removed = await Promise.allSettled(
    files.map((file) => deps.driver.deleteObject(staging, file.objectKey)),
  );
  removed.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error(
        {
          releaseId: release.id,
          key: files[index].objectKey,
          err: result.reason,
        },
        "Staged object left behind after publish",
      );
    }
  });
}

/**
 * The job if one is known, plus the release's status, so the client can tell
 * "published" from "never started or lost in a restart" (still IN_REVIEW).
 */
/**
 * GET /releases/publish-jobs: every job still running or recently settled,
 * with what an admin needs to label it. Lets a page that doesn't know the
 * release ids (after a refresh, another tab) follow publishing.
 */
export async function listPublishJobs() {
  const current = [...jobs.values()].map((job) => ({ ...job }));
  if (current.length === 0) return { jobs: [] };
  const releases = await prisma.release.findMany({
    where: { id: { in: current.map((job) => job.releaseId) } },
    select: { id: true, version: true, product: { select: { name: true } } },
  });
  const byId = new Map(releases.map((release) => [release.id, release]));
  return {
    jobs: current.flatMap((job) => {
      const release = byId.get(job.releaseId);
      // A release deleted since has nothing left to follow
      return release
        ? [
            {
              releaseId: job.releaseId,
              version: release.version,
              productName: release.product.name,
              job,
            },
          ]
        : [];
    }),
  };
}

export async function getPublishStatus(releaseId: string) {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { status: true },
  });
  if (!release) throw releaseNotFound();
  const job = jobs.get(releaseId);
  return { job: job ? { ...job } : null, status: release.status };
}
