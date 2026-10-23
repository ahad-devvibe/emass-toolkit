import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { env } from "../src/configs/env.js";
import { logger } from "../src/configs/logger.js";
import { getStorageClient, getStorageConfig } from "../src/configs/storage.js";
import { createOciDriver } from "../src/services/storage/drivers/oci.driver.js";
import { ApiError } from "../src/utils/api-error.utils.js";

// Spike for publish: how long OCI takes to copy a large release file, and
// whether the copy's percentComplete moves gradually or jumps 0 -> 100.
// Runs against real buckets (needs OCI_* env and credentials):
//   - always: within one bucket (OCI_BUCKET, staged/ -> releases/), like dev
//   - also, when OCI_STAGING_BUCKET and OCI_RELEASE_BUCKET are both set and
//     differ: across buckets, like production
// Size via SMOKE_COPY_MB (default 1024). Every object it creates is deleted.
//   npm run storage:copy-smoke
const SIZE_MB = Number(process.env.SMOKE_COPY_MB ?? 1024);
const CHUNK_BYTES = 1024 ** 2;

interface Mode {
  name: string;
  fromBucket: string;
  toBucket: string;
}

/** Random bytes, logging every ~10% so a slow upload doesn't look like a hang. */
async function* randomBody(bytes: number, mode: string) {
  const started = Date.now();
  let nextLog = 10;
  for (let sent = 0; sent < bytes; sent += CHUNK_BYTES) {
    yield randomBytes(Math.min(CHUNK_BYTES, bytes - sent));
    const percent = Math.floor(((sent + CHUNK_BYTES) / bytes) * 100);
    if (percent >= nextLog && percent < 100) {
      logger.info(
        { mode, percent, elapsedMs: Date.now() - started },
        "upload progress",
      );
      nextLog = percent - (percent % 10) + 10;
    }
  }
}

/** Throughput in Mbit/s for `bytes` moved in `ms`. */
const mbps = (bytes: number, ms: number) =>
  Math.round(((bytes * 8) / 1e6 / (ms / 1000)) * 10) / 10;

async function objectSize(bucket: string, key: string): Promise<number> {
  const { namespace } = getStorageConfig();
  const client = await getStorageClient();
  const head = await client.headObject({
    namespaceName: namespace,
    bucketName: bucket,
    objectName: key,
  });
  return head.contentLength;
}

async function run(mode: Mode) {
  const driver = createOciDriver();
  const bytes = SIZE_MB * 1024 ** 2;
  const id = randomUUID();
  const fromKey = `staged/_smoke/${id}/big.bin`;
  const toKey = `releases/_smoke/${id}/big.bin`;
  const samples: { percent: number; elapsedMs: number }[] = [];

  try {
    logger.info({ mode: mode.name, sizeMb: SIZE_MB }, "uploading source");
    const uploadStarted = Date.now();
    await driver.putStream({
      bucket: mode.fromBucket,
      key: fromKey,
      body: randomBody(bytes, mode.name),
    });
    const uploadMs = Date.now() - uploadStarted;

    logger.info({ mode: mode.name }, "copying");
    const copyStarted = Date.now();
    await driver.copyObject({
      fromBucket: mode.fromBucket,
      fromKey,
      toBucket: mode.toBucket,
      toKey,
      onProgress: (percent) => {
        const sample = { percent, elapsedMs: Date.now() - copyStarted };
        samples.push(sample);
        logger.info(sample, "copy progress");
      },
    });
    const copyMs = Date.now() - copyStarted;

    const copied = await objectSize(mode.toBucket, toKey);
    if (copied !== bytes) {
      throw new Error(`destination has ${copied} bytes, expected ${bytes}`);
    }

    const gradual = samples.some((s) => s.percent > 0 && s.percent < 100);
    logger.info(
      {
        mode: mode.name,
        fromBucket: mode.fromBucket,
        toBucket: mode.toBucket,
        sizeMb: SIZE_MB,
        uploadMs,
        uploadMbps: mbps(bytes, uploadMs),
        copyMs,
        progressValues: samples.map((s) => s.percent),
        progress: gradual ? "gradual" : "jumps 0 -> 100",
      },
      "copy smoke summary",
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === "COPY_FAILED") {
      logger.error(
        { mode: mode.name },
        "The copy work request failed. In OCI the copy runs as the Object Storage service itself, which needs its own policy, e.g. `Allow service objectstorage-<region> to manage object-family in compartment <compartment>`.",
      );
    }
    throw err;
  } finally {
    // Best effort: a missing object counts as deleted
    await Promise.allSettled([
      driver.deleteObject(mode.fromBucket, fromKey),
      driver.deleteObject(mode.toBucket, toKey),
    ]);
  }
}

async function main() {
  if (!env.OCI_BUCKET) throw new Error("Set OCI_BUCKET (and OCI_* auth) first");
  const modes: Mode[] = [
    {
      name: "same bucket",
      fromBucket: env.OCI_BUCKET,
      toBucket: env.OCI_BUCKET,
    },
  ];
  if (
    env.OCI_STAGING_BUCKET &&
    env.OCI_RELEASE_BUCKET &&
    env.OCI_STAGING_BUCKET !== env.OCI_RELEASE_BUCKET
  ) {
    modes.push({
      name: "across buckets",
      fromBucket: env.OCI_STAGING_BUCKET,
      toBucket: env.OCI_RELEASE_BUCKET,
    });
  } else {
    logger.info(
      "OCI_STAGING_BUCKET / OCI_RELEASE_BUCKET not both set: skipping the across-buckets run",
    );
  }

  for (const mode of modes) await run(mode);
}

main().catch((err: unknown) => {
  logger.error({ err }, "storage copy smoke test failed");
  process.exitCode = 1;
});
