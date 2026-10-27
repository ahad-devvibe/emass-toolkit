import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "../../../configs/env.js";
import { logger } from "../../../configs/logger.js";
import { ApiError } from "../../../utils/api-error.utils.js";
import { signLocalLink } from "../storage.utils.js";
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

    async readRange(bucket, key, offset, length) {
      const target = objectPath(bucket, key);
      let handle;
      try {
        handle = await open(target, "r");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw ApiError.notFound(
            "The file is missing from storage",
            "SOURCE_NOT_FOUND",
          );
        }
        logger.error({ bucket, key, err: error }, "Local readRange failed");
        throw new ApiError(502, "Unable to read file", "READ_FAILED");
      }
      try {
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await handle.read(bytes, 0, length, offset);
        if (bytesRead !== length) {
          throw new ApiError(502, "Unable to read file", "READ_FAILED");
        }
        return bytes;
      } finally {
        await handle.close();
      }
    },

    // Stands in for an OCI PAR: a signed link served by /api/files/local
    async createReadUrl({ bucket, key, fileName, expiresInSeconds }) {
      objectPath(bucket, key);
      const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
      const token = signLocalLink(
        { bucket, key, name: fileName, exp: expiresAt.getTime() },
        env.JWT_SECRET,
      );
      return { url: `/api/files/local/${token}`, expiresAt };
    },
  };
}

/** Where the local driver keeps an object; throws on keys that escape the root. */
export function localObjectPath(
  bucket: string,
  key: string,
  root: string = path.resolve(env.STORAGE_LOCAL_DIR),
): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, bucket, key);
  if (!target.startsWith(resolvedRoot + path.sep)) {
    throw new ApiError(400, "Invalid object key", "INVALID_OBJECT_KEY");
  }
  return target;
}
