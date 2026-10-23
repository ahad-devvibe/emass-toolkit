import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../../../configs/env.js";
import { logger } from "../../../configs/logger.js";
import { ApiError } from "../../../utils/api-error.utils.js";
import type { StorageDriver } from "./storage.driver.js";

/**
 * Filesystem driver for dev and tests: objects live at <root>/<bucket>/<key>.
 * Writes go to a .part file that is renamed on success, so a failed or
 * aborted upload (or copy) never leaves a visible object.
 */
export function createLocalDriver(
  root: string = path.resolve(env.STORAGE_LOCAL_DIR),
): StorageDriver {
  const resolvedRoot = path.resolve(root);

  const objectPath = (bucket: string, key: string) => {
    const target = path.resolve(resolvedRoot, bucket, key);
    if (!target.startsWith(resolvedRoot + path.sep)) {
      throw new ApiError(400, "Invalid object key", "INVALID_OBJECT_KEY");
    }
    return target;
  };

  return {
    async putStream({ bucket, key, body }) {
      const target = objectPath(bucket, key);
      const partFile = `${target}.${randomUUID()}.part`;
      await mkdir(path.dirname(target), { recursive: true });

      try {
        await pipeline(Readable.from(body), createWriteStream(partFile));
        await rename(partFile, target);
      } catch (error) {
        await rm(partFile, { force: true });
        throw error;
      }
    },

    async deleteObject(bucket, key) {
      const target = objectPath(bucket, key);
      try {
        await rm(target, { force: true });
      } catch (error) {
        logger.error({ bucket, key, err: error }, "Local deleteObject failed");
        throw new ApiError(502, "Unable to delete file", "DELETE_FAILED");
      }
    },

    // Copies via a .part file too, so a failed copy never leaves a destination
    async copyObject({ fromBucket, fromKey, toBucket, toKey, onProgress }) {
      const source = objectPath(fromBucket, fromKey);
      const target = objectPath(toBucket, toKey);
      const partFile = `${target}.${randomUUID()}.part`;
      onProgress?.(0);

      try {
        await mkdir(path.dirname(target), { recursive: true });
        await copyFile(source, partFile);
        await rename(partFile, target);
      } catch (error) {
        await rm(partFile, { force: true });
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw ApiError.notFound(
            "The file to copy is missing",
            "SOURCE_NOT_FOUND",
          );
        }
        logger.error(
          { fromBucket, fromKey, toBucket, toKey, err: error },
          "Local copyObject failed",
        );
        throw new ApiError(502, "Unable to copy file", "COPY_FAILED");
      }
      onProgress?.(100);
    },
  };
}
