import { randomUUID } from "node:crypto";
import { models, type requests } from "oci-objectstorage";
import { env } from "../../../configs/env.js";
import { logger } from "../../../configs/logger.js";
import {
  getStorageClient,
  getStorageConfig,
  type ObjectStorageClientLike,
  type StorageConfig,
} from "../../../configs/storage.js";
import { ApiError } from "../../../utils/api-error.utils.js";
import { chunkStream, contentDispositionAttachment } from "../storage.utils.js";
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
    async putStream({ bucket, key, contentType, fileName, body }) {
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
          createMultipartUploadDetails: {
            object: key,
            contentType,
            // Stored on the object too, so even a bare link downloads
            ...(fileName && {
              contentDisposition: contentDispositionAttachment(fileName),
            }),
          },
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

    async createReadUrl({ bucket, key, fileName, expiresInSeconds }) {
      const { namespace, region } = getConfig();
      const expiresAt = new Date(now() + expiresInSeconds * 1000);
      try {
        const client = await getClient();
        const { preauthenticatedRequest: par } =
          await client.createPreauthenticatedRequest({
            namespaceName: namespace,
            bucketName: bucket,
            createPreauthenticatedRequestDetails: {
              name: `download-${randomUUID()}`,
              objectName: key,
              accessType:
                models.CreatePreauthenticatedRequestDetails.AccessType
                  .ObjectRead,
              timeExpires: expiresAt,
            },
          });
        // accessUri is a path; newer SDKs also return the full URL
        const base =
          par.fullPath ??
          `https://objectstorage.${region}.oraclecloud.com${par.accessUri}`;
        // The browser ignores <a download> across origins, so OCI itself must
        // say "attachment"; PAR GETs honour this response-header override
        const disposition = encodeURIComponent(
          contentDispositionAttachment(fileName),
        );
        const url = `${base}?httpResponseContentDisposition=${disposition}`;
        return { url, expiresAt };
      } catch (error) {
        logger.error({ bucket, key, err: error }, "OCI read PAR failed");
        throw new ApiError(
          502,
          "Couldn't prepare the download. Try again.",
          "DOWNLOAD_URL_FAILED",
        );
      }
    },

    async readRange(bucket, key, offset, length) {
      if (length === 0) return new Uint8Array(0);
      const { namespace } = getConfig();
      let bytes: Buffer;
      try {
        const client = await getClient();
        const response = await client.getObject({
          namespaceName: namespace,
          bucketName: bucket,
          objectName: key,
          // The SDK reads only these two fields to build "bytes=a-b"
          range: {
            startByte: offset,
            endByte: offset + length - 1,
          } as unknown as requests.GetObjectRequest["range"],
        });
        bytes = await collect(response.value);
      } catch (error) {
        if (isNotFound(error)) {
          throw ApiError.notFound(
            "The file is missing from storage",
            "SOURCE_NOT_FOUND",
          );
        }
        logger.error(
          { bucket, key, offset, length, err: error },
          "OCI readRange failed",
        );
        throw new ApiError(502, "Unable to read file", "READ_FAILED");
      }
      if (bytes.length !== length) {
        logger.error(
          { bucket, key, offset, length, got: bytes.length },
          "OCI readRange returned a short read",
        );
        throw new ApiError(502, "Unable to read file", "READ_FAILED");
      }
      return bytes;
    },
  };
}

/** A GetObject body (a Node stream or a web ReadableStream) as one buffer. */
async function collect(body: unknown): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  if (body && typeof (body as ReadableStream).getReader === "function") {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } else {
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
  }
  return Buffer.concat(chunks);
}
