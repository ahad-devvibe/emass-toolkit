import { randomUUID } from "node:crypto";
import { models } from "oci-objectstorage";
import { logger } from "../../configs/logger.js";
import {
  getStorageClient,
  getStorageConfig,
  type ObjectStorageClientLike,
  type StorageConfig,
} from "../../configs/storage.js";
import { ApiError } from "../../utils/api-error.utils.js";

export const DEFAULT_OBJECT_URL_TTL_SECONDS = 60;

export interface UploadObjectInput {
  key: string;
  buffer: Buffer;
  contentType?: string;
}

export interface ClientInjectors {
  getClient?: () => Promise<ObjectStorageClientLike>;
  getConfig?: () => StorageConfig;
}

export function buildObjectKey(...segments: string[]): string {
  return segments
    .map((segment, index) =>
      index === 0
        ? segment.replace(/\/+$/g, "")
        : segment.replace(/^\/+|\/+$/g, ""),
    )
    .filter((segment) => segment.length > 0)
    .join("/");
}

export function generateObjectKey(prefix: string, extension: string): string {
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");
  return `${cleanPrefix}/${randomUUID()}.${extension}`;
}

async function uploadToOci(
  getClient: () => Promise<ObjectStorageClientLike>,
  getConfig: () => StorageConfig,
  objectKey: string,
  buffer: Buffer,
  contentType: string | undefined,
  errorMessage: string,
): Promise<void> {
  const config = getConfig();
  try {
    const client = await getClient();
    await client.putObject({
      namespaceName: config.namespace,
      bucketName: config.bucket,
      objectName: objectKey,
      putObjectBody: buffer,
      contentLength: buffer.length,
      contentType,
    });
  } catch (error) {
    logger.error({ objectKey, err: error }, "OCI object upload failed");
    throw new ApiError(502, errorMessage, "UPLOAD_FAILED");
  }
}

export async function uploadObject(
  input: UploadObjectInput,
  {
    getClient = getStorageClient,
    getConfig = getStorageConfig,
  }: ClientInjectors = {},
): Promise<string> {
  await uploadToOci(
    getClient,
    getConfig,
    input.key,
    input.buffer,
    input.contentType,
    "Unable to upload object",
  );
  return input.key;
}

export async function deleteObject(
  objectKey: string,
  {
    getClient = getStorageClient,
    getConfig = getStorageConfig,
  }: ClientInjectors = {},
): Promise<void> {
  const config = getConfig();
  try {
    const client = await getClient();
    await client.deleteObject({
      namespaceName: config.namespace,
      bucketName: config.bucket,
      objectName: objectKey,
    });
  } catch (error) {
    logger.error({ objectKey, err: error }, "OCI deleteObject failed");
  }
}

export async function deleteObjects(
  objectKeys: string[],
  injectors: ClientInjectors = {},
): Promise<void> {
  await Promise.allSettled(
    objectKeys.map((key) => deleteObject(key, injectors)),
  );
}

/**
 * Mints a short-lived, read-only, object-level pre-authenticated request (PAR).
 * The bucket stays private; the returned URL is valid only for the TTL.
 */
export async function getObjectUrl(
  objectKey: string,
  expiresInSeconds: number = DEFAULT_OBJECT_URL_TTL_SECONDS,
  {
    getClient = getStorageClient,
    getConfig = getStorageConfig,
  }: ClientInjectors = {},
): Promise<string> {
  const config = getConfig();
  if (expiresInSeconds <= 0) {
    throw new ApiError(400, "URL lifetime must be positive", "URL_TTL_INVALID");
  }
  try {
    const client = await getClient();
    const response = await client.createPreauthenticatedRequest({
      namespaceName: config.namespace,
      bucketName: config.bucket,
      createPreauthenticatedRequestDetails: {
        name: `portal-${randomUUID()}`,
        objectName: objectKey,
        accessType:
          models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: new Date(Date.now() + expiresInSeconds * 1000),
      },
    });
    return response.preauthenticatedRequest.accessUri;
  } catch (error) {
    logger.error(
      { objectKey, err: error },
      "OCI createPreauthenticatedRequest failed",
    );
    throw new ApiError(502, "Unable to create download URL", "URL_FAILED");
  }
}
