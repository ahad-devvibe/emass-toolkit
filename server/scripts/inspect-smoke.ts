import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "../src/configs/logger.js";
import { getStorageBuckets } from "../src/configs/storage.js";
import { inspectFile } from "../src/services/releases/file-inspect/inspect.js";
import { blockReader } from "../src/services/releases/file-inspect/range-reader.js";
import { createOciDriver } from "../src/services/storage/drivers/oci.driver.js";

// Measures what upload enforcement costs on the real staging bucket (needs
// OCI_* env and credentials): each file is uploaded to staged/_smoke/, its
// version is read back with ranged GETs (as the server does after every
// upload), then the object is deleted.
//   npm run storage:inspect-smoke -- <file> [file...]
async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error("Pass one or more files to inspect");
  const driver = createOciDriver();
  const { staging } = getStorageBuckets();
  const prefix = `staged/_smoke/${randomUUID()}`;

  for (const file of files) {
    const name = path.basename(file);
    const key = `${prefix}/${name}`;
    const { size } = await stat(file);

    const uploadStarted = Date.now();
    await driver.putStream({
      bucket: staging,
      key,
      body: createReadStream(file),
    });
    const uploadMs = Date.now() - uploadStarted;

    try {
      let requests = 0;
      let bytes = 0;
      const reader = blockReader(size, (ranges) =>
        Promise.all(
          ranges.map(({ offset, length }) => {
            requests += 1;
            bytes += length;
            return driver.readRange(staging, key, offset, length);
          }),
        ),
      );
      const started = Date.now();
      const result = await inspectFile(reader, name);
      logger.info(
        {
          file: name,
          sizeMb: +(size / 1024 ** 2).toFixed(1),
          uploadMs,
          format: result.format,
          versions: [...new Set(result.versions.map((v) => v.version))],
          damaged: result.damaged,
          rangedGets: requests,
          kbRead: Math.round(bytes / 1024),
          inspectMs: Date.now() - started,
        },
        "inspected the stored object",
      );
    } finally {
      await driver.deleteObject(staging, key);
    }
  }
}

main().catch((err: unknown) => {
  logger.error({ err }, "inspect smoke test failed");
  process.exitCode = 1;
});
