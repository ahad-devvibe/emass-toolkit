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
// then aborts an upload midway and checks no object was left behind. Then
// the piece-by-piece path resumable uploads use: create, parts one call at a
// time (one sent twice), complete, verify; and an aborted one refuses parts.
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

  // Resumable uploads: each part is its own call, as each arrives in its own request
  const partSize = 10 * 1024 ** 2;
  const pieces = randomBytes(2 * partSize + 12345);
  const pieceKey = `${prefix}/pieces.bin`;
  const target = {
    bucket: staging,
    key: pieceKey,
    uploadId: await driver.createUpload({
      bucket: staging,
      key: pieceKey,
      fileName: "pieces.bin",
    }),
  };
  const part = (n: number) => pieces.subarray((n - 1) * partSize, n * partSize);
  const etags: { partNum: number; etag: string }[] = [];
  for (const n of [1, 2, 3]) {
    etags.push({
      partNum: n,
      etag: await driver.uploadPart({ ...target, partNum: n, body: part(n) }),
    });
  }
  // A retried part replaces itself; commit with the etag of the last send
  etags[1].etag = await driver.uploadPart({
    ...target,
    partNum: 2,
    body: part(2),
  });
  // Commit what OCI holds now, as the server does: part 2 was sent twice
  const listed = await driver.listParts(target);
  if (listed.map((part) => part.partNum).join() !== "1,2,3") {
    throw new Error(
      `OCI lists parts ${listed.map((part) => part.partNum).join()}`,
    );
  }
  if (listed[1].etag !== etags[1].etag) {
    throw new Error("OCI kept another etag for the part sent twice");
  }
  await driver.completeUpload({
    ...target,
    parts: listed.map(({ partNum, etag }) => ({ partNum, etag })),
  });
  if ((await objectSize(staging, pieceKey)) !== pieces.length) {
    throw new Error("piece-by-piece upload has the wrong size");
  }
  const seam = await driver.readRange(staging, pieceKey, partSize - 100, 200);
  if (
    !pieces.subarray(partSize - 100, partSize + 100).equals(Buffer.from(seam))
  ) {
    throw new Error("piece-by-piece upload came back different at a seam");
  }
  await driver.deleteObject(staging, pieceKey);
  logger.info("piece-by-piece upload committed and verified");

  const abandonedKey = `${prefix}/abandoned.bin`;
  const abandoned = {
    bucket: staging,
    key: abandonedKey,
    uploadId: await driver.createUpload({ bucket: staging, key: abandonedKey }),
  };
  await driver.uploadPart({ ...abandoned, partNum: 1, body: part(1) });
  await driver.abortUpload(abandoned);
  await driver.abortUpload(abandoned);
  const refused = await driver
    .uploadPart({ ...abandoned, partNum: 2, body: part(2) })
    .then(
      () => null,
      (error: { code?: string }) => error.code,
    );
  if (refused !== "UPLOAD_NOT_FOUND") {
    throw new Error(`a part after abort gave ${refused ?? "success"}`);
  }
  if ((await objectSize(staging, abandonedKey)) !== null) {
    throw new Error("aborted piece-by-piece upload left an object");
  }
  logger.info("aborted piece-by-piece upload refuses parts and leaves nothing");
}

main().catch((err: unknown) => {
  logger.error({ err }, "storage smoke test failed");
  process.exitCode = 1;
});
