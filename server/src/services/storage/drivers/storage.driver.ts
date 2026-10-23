import { env } from "../../../configs/env.js";
import { createLocalDriver } from "./local.driver.js";
import { createOciDriver } from "./oci.driver.js";

export interface PutStreamInput {
  bucket: string;
  key: string;
  contentType?: string;
  body: AsyncIterable<Buffer | Uint8Array>;
}

export interface CopyObjectInput {
  fromBucket: string;
  fromKey: string;
  toBucket: string;
  toKey: string;
  /** 0–100 as the copy advances; called with 100 once it's done. */
  onProgress?: (percent: number) => void;
}

/**
 * Streaming object storage used by release files. `putStream` consumes the
 * body and commits the object only if the body ends cleanly; if the body
 * errors (client abort, size limit) nothing is left behind and the body's
 * error is rethrown unchanged. `deleteObject` is strict: a missing object
 * counts as deleted, any other failure throws DELETE_FAILED.
 *
 * `copyObject` (publish: staging → release bucket, or between prefixes of one
 * bucket in dev) resolves only once the destination exists. It overwrites an
 * existing destination, so a retry is safe; a missing source throws
 * SOURCE_NOT_FOUND, other failures COPY_FAILED or COPY_TIMEOUT.
 */
export interface StorageDriver {
  putStream(input: PutStreamInput): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  copyObject(input: CopyObjectInput): Promise<void>;
}

let driver: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  driver ??=
    env.STORAGE_DRIVER === "oci" ? createOciDriver() : createLocalDriver();
  return driver;
}
