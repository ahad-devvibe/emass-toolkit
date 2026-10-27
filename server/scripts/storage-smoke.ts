import "dotenv/config";
import { randomBytes, randomUUID } from "node:crypto";
import { logger } from "../src/configs/logger.js";
import {
  getStorageBuckets,
  getStorageClient,
  getStorageConfig,
} from "../src/configs/storage.js";
import { createOciDriver } from "../src/services/storage/drivers/oci.driver.js";

// Checks the OCI multipart path against the real staging bucket (needs OCI_*
// env and credentials). Uploads ~50 MB in parts, verifies it, reads byte
// ranges back (file inspection reads staged objects this way), deletes it,
// then aborts an upload midway and checks no object was left behind.
//   npm run storage:smoke
const TOTAL_BYTES = 50 * 1024 ** 2;
const CHUNK_BYTES = 1024 ** 2;

async function* randomBody(bytes: number, failAfter?: number) {
  for (let sent = 0; sent < bytes; sent += CHUNK_BYTES) {
    if (failAfter !== undefined && sent >= failAfter) {
      throw new Error("simulated client abort");
    }
    yield randomBytes(Math.min(CHUNK_BYTES, bytes - sent));
  }
}

async function objectSize(bucket: string, key: string): Promise<number | null> {
  const { namespace } = getStorageConfig();
  const client = await getStorageClient();
  try {
    const head = await client.headObject({
      namespaceName: namespace,
      bucketName: bucket,
      objectName: key,
    });
    return head.contentLength;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return null;
    throw error;
  }
}

async function main() {
  const driver = createOciDriver();
  const { staging } = getStorageBuckets();
  const prefix = `staged/_smoke/${randomUUID()}`;

  const okKey = `${prefix}/ok.bin`;
  const data = randomBytes(TOTAL_BYTES);
  const started = Date.now();
  await driver.putStream({
    bucket: staging,
    key: okKey,
    body: (async function* () {
      for (let at = 0; at < TOTAL_BYTES; at += CHUNK_BYTES) {
        yield data.subarray(at, at + CHUNK_BYTES);
      }
    })(),
  });
  const size = await objectSize(staging, okKey);
  if (size !== TOTAL_BYTES)
    throw new Error(`expected ${TOTAL_BYTES} bytes, got ${size}`);
  logger.info(
    { key: okKey, ms: Date.now() - started },
    "multipart upload committed",
  );

  // The start, a range spanning multipart part boundaries, and the very end
  for (const [offset, length] of [
    [0, 64 * 1024],
    [TOTAL_BYTES / 2 - 1000, 128 * 1024],
    [TOTAL_BYTES - 4096, 4096],
  ]) {
    const readStarted = Date.now();
    const bytes = await driver.readRange(staging, okKey, offset, length);
    if (!data.subarray(offset, offset + length).equals(Buffer.from(bytes))) {
      throw new Error(`range ${offset}+${length} came back different`);
    }
    logger.info(
      { offset, length, ms: Date.now() - readStarted },
      "ranged read matches",
    );
  }

  await driver.deleteObject(staging, okKey);
  if ((await objectSize(staging, okKey)) !== null)
    throw new Error("object survived delete");
  await driver.deleteObject(staging, okKey);
  logger.info("delete is idempotent");

  const abortedKey = `${prefix}/aborted.bin`;
  const failed = await driver
    .putStream({
      bucket: staging,
      key: abortedKey,
      body: randomBody(TOTAL_BYTES, 25 * 1024 ** 2),
    })
    .then(
      () => false,
      () => true,
    );
  if (!failed) throw new Error("aborted upload unexpectedly succeeded");
  if ((await objectSize(staging, abortedKey)) !== null) {
    throw new Error("aborted upload left an object behind");
  }
  logger.info("aborted upload left no object");
}

main().catch((err: unknown) => {
  logger.error({ err }, "storage smoke test failed");
  process.exitCode = 1;
});
