import { env } from "../../../configs/env.js";
import { logger } from "../../../configs/logger.js";
import {
  getStorageClient,
  getStorageConfig,
  type ObjectStorageClientLike,
  type StorageConfig,
} from "../../../configs/storage.js";
import { ApiError } from "../../../utils/api-error.utils.js";
import { chunkStream } from "../storage.utils.js";
import type { StorageDriver } from "./storage.driver.js";

export interface OciDriverOptions {
  getClient?: () => Promise<ObjectStorageClientLike>;
  getConfig?: () => StorageConfig;
  partSize?: number;
  /** How often to poll a copy's work request. */
  pollMs?: number;
  /** How long one copy may take before COPY_TIMEOUT. */
  timeoutMs?: number;
  /** Injectable wait (tests skip the real delay). */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

// Work request states that end a copy without a destination object
const FAILED_STATES = new Set(["FAILED", "CANCELING", "CANCELED"]);

const copyFailed = () =>
  new ApiError(502, "Unable to copy file", "COPY_FAILED");

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { statusCode?: unknown }).statusCode === 404
  );
}

/**
 * Streams uploads into an OCI multipart upload, one part in memory at a time.
 * Every upload goes through multipart (even tiny files) so there is one path.
 * Copies run server-side in OCI as work requests; the driver polls them for
 * progress. The same call copies within one bucket (dev: staged/ → releases/)
 * or across buckets (prod: staging → release bucket).
 */
export function createOciDriver({
  getClient = getStorageClient,
  getConfig = getStorageConfig,
  partSize = env.UPLOAD_PART_BYTES,
  pollMs = env.COPY_POLL_MS,
  timeoutMs = env.COPY_TIMEOUT_MS,
  sleep = wait,
  now = Date.now,
}: OciDriverOptions = {}): StorageDriver {
  return {
    async putStream({ bucket, key, contentType, body }) {
      const { namespace } = getConfig();
      const target = { namespaceName: namespace, bucketName: bucket };

      // Provider failures become UPLOAD_FAILED; body errors pass through as-is
      const provider = async <T>(call: () => Promise<T>): Promise<T> => {
        try {
          return await call();
        } catch (error) {
          logger.error({ key, err: error }, "OCI multipart upload failed");
          throw new ApiError(502, "Unable to upload file", "UPLOAD_FAILED");
        }
      };

      const client = await provider(getClient);
      const { multipartUpload } = await provider(() =>
        client.createMultipartUpload({
          ...target,
          createMultipartUploadDetails: { object: key, contentType },
        }),
      );
      const upload = {
        ...target,
        objectName: key,
        uploadId: multipartUpload.uploadId,
      };

      try {
        const parts: { partNum: number; etag: string }[] = [];
        const send = async (part: Buffer) => {
          const partNum = parts.length + 1;
          const { eTag } = await provider(() =>
            client.uploadPart({
              ...upload,
              uploadPartNum: partNum,
              uploadPartBody: part,
              contentLength: part.length,
            }),
          );
          parts.push({ partNum, etag: eTag });
        };

        for await (const part of chunkStream(body, partSize)) await send(part);
        // A commit needs at least one part, so an empty file sends an empty one
        if (parts.length === 0) await send(Buffer.alloc(0));

        await provider(() =>
          client.commitMultipartUpload({
            ...upload,
            commitMultipartUploadDetails: { partsToCommit: parts },
          }),
        );
      } catch (error) {
        try {
          await client.abortMultipartUpload(upload);
        } catch (abortError) {
          // The bucket lifecycle rule cleans up uploads that fail to abort
          logger.error(
            { key, uploadId: upload.uploadId, err: abortError },
            "OCI abortMultipartUpload failed",
          );
        }
        throw error;
      }
    },

    async deleteObject(bucket, key) {
      const { namespace } = getConfig();
      try {
        const client = await getClient();
        await client.deleteObject({
          namespaceName: namespace,
          bucketName: bucket,
          objectName: key,
        });
      } catch (error) {
        if (isNotFound(error)) return;
        logger.error({ bucket, key, err: error }, "OCI deleteObject failed");
        throw new ApiError(502, "Unable to delete file", "DELETE_FAILED");
      }
    },

    async copyObject({ fromBucket, fromKey, toBucket, toKey, onProgress }) {
      const { namespace, region } = getConfig();
      const context = { fromBucket, fromKey, toBucket, toKey };

      let client: ObjectStorageClientLike;
      let workRequestId: string;
      try {
        client = await getClient();
        const started = await client.copyObject({
          namespaceName: namespace,
          bucketName: fromBucket,
          copyObjectDetails: {
            sourceObjectName: fromKey,
            destinationRegion: region,
            destinationNamespace: namespace,
            destinationBucket: toBucket,
            destinationObjectName: toKey,
          },
        });
        workRequestId = started.opcWorkRequestId;
      } catch (error) {
        if (isNotFound(error)) {
          throw ApiError.notFound(
            "The file to copy is missing",
            "SOURCE_NOT_FOUND",
          );
        }
        logger.error({ ...context, err: error }, "OCI copyObject failed");
        throw copyFailed();
      }

      const deadline = now() + timeoutMs;
      let reported: number | undefined;
      const report = (percent: number) => {
        if (percent === reported) return;
        reported = percent;
        onProgress?.(percent);
      };

      for (;;) {
        let status: string | undefined;
        let percent: number | undefined;
        try {
          const { workRequest } = await client.getWorkRequest({
            workRequestId,
          });
          status = workRequest.status;
          percent = workRequest.percentComplete;
        } catch (error) {
          logger.error(
            { ...context, workRequestId, err: error },
            "OCI getWorkRequest failed",
          );
          throw copyFailed();
        }

        if (status === "COMPLETED") {
          report(100);
          return;
        }
        if (status && FAILED_STATES.has(status)) {
          logger.error(
            { ...context, workRequestId, status },
            "OCI copy work request did not complete",
          );
          throw copyFailed();
        }
        // ACCEPTED, IN_PROGRESS, or a state this SDK doesn't know yet
        report(Math.min(99, Math.max(0, Math.floor(percent ?? 0))));

        if (now() >= deadline) {
          // The copy may still finish in OCI; a retry overwrites the same key
          logger.error(
            { ...context, workRequestId, timeoutMs },
            "OCI copy timed out",
          );
          throw new ApiError(
            504,
            "Copying the file took too long",
            "COPY_TIMEOUT",
          );
        }
        await sleep(pollMs);
      }
    },
  };
}
