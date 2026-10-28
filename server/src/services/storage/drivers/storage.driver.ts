import { env } from "../../../configs/env.js";
import { createLocalDriver } from "./local.driver.js";
import { createOciDriver } from "./oci.driver.js";

export interface PutStreamInput {
  bucket: string;
  key: string;
  contentType?: string;
  /** Saved as the object's Content-Disposition (attachment), where supported. */
  fileName?: string;
  body: AsyncIterable<Buffer | Uint8Array>;
}

export interface ReadUrlInput {
  bucket: string;
  key: string;
  /** What the browser saves the file as (local driver; OCI uses the key). */
  fileName: string;
  expiresInSeconds: number;
}

export interface ReadUrl {
  url: string;
  expiresAt: Date;
}

export interface CreateUploadInput {
  bucket: string;
  key: string;
  contentType?: string;
  /** Saved as the object's Content-Disposition (attachment), where supported. */
  fileName?: string;
}

/** One open multipart upload: the object it will become and the provider's id. */
export interface UploadTarget {
  bucket: string;
  key: string;
  uploadId: string;
}

export interface UploadedPart {
  partNum: number;
  etag: string;
}

/** A part as storage holds it: the etag to commit, and what it contains. */
export interface StoredPart extends UploadedPart {
  /** Base64 MD5 of the part's bytes. */
  md5: string;
  size: number;
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
 *
 * `createReadUrl` returns a time-limited, read-only link to one object (an
 * OCI object PAR; a signed /api/files/local link for the local driver).
 *
 * `readRange` returns exactly `length` bytes from `offset` (an OCI ranged
 * GET), so file inspection reads a few KB of a large staged object. A missing
 * object throws SOURCE_NOT_FOUND; a short read or other failure READ_FAILED.
 *
 * Multipart, for uploads that arrive piece by piece across requests:
 * `createUpload` opens one and returns its id; `uploadPart` stores part
 * `partNum` (1-based; sending a number again replaces that part) and returns
 * its etag; `completeUpload` commits the listed parts in order, and only then
 * does the object exist; `abortUpload` discards it, and an upload that is
 * already gone counts as aborted. A part or commit for an unknown upload throws
 * UPLOAD_NOT_FOUND; a request storage refuses for good UPLOAD_REJECTED; other
 * provider failures UPLOAD_FAILED. `listParts` returns the parts storage holds
 * now (sending a part number twice keeps only the last, with a new etag), so a
 * commit can use them rather than etags remembered earlier. `putStream` is
 * built on these.
 */
export interface StorageDriver {
  putStream(input: PutStreamInput): Promise<void>;
  deleteObject(bucket: string, key: string): Promise<void>;
  copyObject(input: CopyObjectInput): Promise<void>;
  createReadUrl(input: ReadUrlInput): Promise<ReadUrl>;
  readRange(
    bucket: string,
    key: string,
    offset: number,
    length: number,
  ): Promise<Uint8Array>;
  createUpload(input: CreateUploadInput): Promise<string>;
  uploadPart(
    target: UploadTarget & { partNum: number; body: Buffer },
  ): Promise<string>;
  completeUpload(
    target: UploadTarget & { parts: UploadedPart[] },
  ): Promise<void>;
  abortUpload(target: UploadTarget): Promise<void>;
  listParts(target: UploadTarget): Promise<StoredPart[]>;
}

let driver: StorageDriver | undefined;

export function getStorageDriver(): StorageDriver {
  driver ??=
    env.STORAGE_DRIVER === "oci" ? createOciDriver() : createLocalDriver();
  return driver;
}
