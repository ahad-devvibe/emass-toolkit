import {
  ReleaseEventType,
  ReleaseStatus,
  type Release,
  type ReleaseFile,
} from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getStorageBucket } from "../../configs/storage.js";
import type { PublishReleaseInput } from "../../schemas/releases.schema.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  getStorageDriver,
  type StorageDriver,
} from "../storage/drivers/storage.driver.js";
import { publishedKey } from "../storage/storage.utils.js";
import { enqueueReleaseAnnouncement } from "../email/email-outbox.service.js";
import { emailWorker } from "../email/email-worker.js";
import { isRunning, jobs, type PublishJob } from "./publish-jobs.js";
import { expireStaleSessions } from "./upload-sessions.service.js";
import { releaseChanged, releaseNotFound } from "./releases.errors.js";
import {
  EDITABLE_STATUSES,
  requiredSemver,
  versionOf,
} from "./releases.utils.js";
import {
  assertNewerThanShipped,
  assertPublishable,
  lockProductReleases,
  lockRelease,
} from "./releases.service.js";

// Publish copies every file draft/ → publish/, which can take minutes for
// large builds, so it runs as a background job the developer's dialog polls.
// Jobs live in memory (one VM). The database only changes in the final
// transaction, so a restart mid-job never leaves a half-published release,
// and a retry is safe: published keys are deterministic (same uuid).

export type { PublishJob, PublishPhase } from "./publish-jobs.js";

export interface PublishDeps {
  driver: StorageDriver;
  bucket: () => string;
  now: () => Date;
  ttlMs: number;
}

const defaultDeps = (): PublishDeps => ({
  driver: getStorageDriver(),
  bucket: getStorageBucket,
  now: () => new Date(),
  ttlMs: env.PUBLISH_JOB_TTL_MS,
});

// Files uploaded before inspection existed are read from storage once
const PUBLISH_CHECK_TIMEOUT_MS = 30_000;
// Finalize may wait on the product lock behind a rollback or another publish
const FINALIZE_TIMEOUT_MS = 30_000;

const expiries = new Map<string, NodeJS.Timeout>();

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

type FileToPublish = Pick<
  ReleaseFile,
  "id" | "objectKey" | "sizeBytes" | "kind" | "platform"
>;
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
 * Start publishing a draft. Checks everything it can up front (status, files
 * mapped and allowed, version still newer) and throws those as normal 4xx
 * errors; otherwise registers a job, starts it without waiting and returns
 * it. A second call while a job runs returns the same job.
 */
export async function startPublish(
  devId: string,
  releaseId: string,
  input: PublishReleaseInput = {},
  deps: PublishDeps = defaultDeps(),
): Promise<PublishJob> {
  const running = jobs.get(releaseId);
  if (running && isRunning(running)) return { ...running };

  // Abandoned uploads shouldn't hold the release back
  await expireStaleSessions(releaseId);

  const { release, files, note } = await prisma.$transaction(
    async (tx) => {
      const locked = await lockRelease(tx, releaseId, EDITABLE_STATUSES);
      const rows = await tx.releaseFile.findMany({
        where: { releaseId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const warnings = await assertPublishable(tx, locked, rows, input);
      return { release: locked, files: rows, note: warnings };
    },
    { timeout: PUBLISH_CHECK_TIMEOUT_MS },
  );

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

  void runPublish(job, devId, release, files, note, deps).catch(
    (err: unknown) => logger.error({ releaseId, err }, "Publish job crashed"),
  );
  return { ...job };
}

async function runPublish(
  job: PublishJob,
  devId: string,
  release: ReleaseToPublish,
  files: FileToPublish[],
  note: string | null,
  deps: PublishDeps,
): Promise<void> {
  const bucket = deps.bucket();
  const sizes = files.map((file) => Number(file.sizeBytes));
  const copiedKeys: string[] = [];
  // The checks passed, so it has a version
  const version = versionOf(release);
  const destination = (file: { objectKey: string }) =>
    publishedKey(file.objectKey, release.productId, version);

  try {
    for (const [index, file] of files.entries()) {
      const toKey = destination(file);
      await deps.driver.copyObject({
        fromBucket: bucket,
        fromKey: file.objectKey,
        toBucket: bucket,
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
        const locked = await lockRelease(tx, release.id, EDITABLE_STATUSES);

        // Edits are refused while a job runs, but one that got in before the
        // job started would leave these copies stale or under the wrong path
        const current = await tx.releaseFile.findMany({
          where: { releaseId: release.id },
          select: { id: true, objectKey: true, kind: true, platform: true },
        });
        const copied = new Map(files.map((file) => [file.id, file]));
        if (
          locked.version !== release.version ||
          locked.productId !== release.productId ||
          current.length !== files.length ||
          current.some((file) => {
            const was = copied.get(file.id);
            return (
              was?.objectKey !== file.objectKey ||
              was.kind !== file.kind ||
              was.platform !== file.platform
            );
          })
        ) {
          throw releaseChanged();
        }

        // Another release of the product may have shipped meanwhile
        await assertNewerThanShipped(
          tx,
          release.productId,
          requiredSemver(release),
        );

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
              actorId: devId,
              note: `Replaced by v${version}`,
            },
          });
        }

        await tx.release.update({
          where: { id: release.id },
          data: {
            status: ReleaseStatus.PUBLISHED,
            publishedAt: deps.now(),
            publishedById: devId,
          },
        });
        for (const file of files) {
          await tx.releaseFile.update({
            where: { id: file.id },
            data: { objectKey: destination(file) },
          });
        }
        const published = await tx.releaseEvent.create({
          data: {
            releaseId: release.id,
            type: ReleaseEventType.PUBLISHED,
            actorId: devId,
            note,
          },
          select: { id: true },
        });

        // Announced to everyone who downloaded the product before, queued
        // with the publish so both happen or neither does
        const product = await tx.product.findUniqueOrThrow({
          where: { id: release.productId },
          select: { name: true },
        });
        const base = env.APP_BASE_URL.replace(/\/+$/, "");
        await enqueueReleaseAnnouncement(tx, {
          batchId: published.id,
          productId: release.productId,
          releaseId: release.id,
          payload: {
            productName: product.name,
            version,
            url: `${base}/catalog/${release.productId}`,
          },
        });
      },
      { timeout: FINALIZE_TIMEOUT_MS },
    );
  } catch (error) {
    // All or nothing: drop the copies; the database never changed
    const cleanup = await Promise.allSettled(
      copiedKeys.map((key) => deps.driver.deleteObject(bucket, key)),
    );
    cleanup.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.error(
          { releaseId: release.id, key: copiedKeys[index], err: result.reason },
          "Orphaned published copy after a failed publish",
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
  emailWorker.kick();

  // Published: the draft copies are no longer needed (and never served)
  const removed = await Promise.allSettled(
    files.map((file) => deps.driver.deleteObject(bucket, file.objectKey)),
  );
  removed.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error(
        {
          releaseId: release.id,
          key: files[index].objectKey,
          err: result.reason,
        },
        "Draft object left behind after publish",
      );
    }
  });
}

/**
 * GET /releases/publish-jobs: every job still running or recently settled,
 * with what a developer needs to label it. Lets a page that doesn't know the
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

/**
 * The job if one is known, plus the release's status, so the client can tell
 * "published" from "never started or lost in a restart" (still DRAFT).
 */
export async function getPublishStatus(releaseId: string) {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { status: true },
  });
  if (!release) throw releaseNotFound();
  const job = jobs.get(releaseId);
  return { job: job ? { ...job } : null, status: release.status };
}
