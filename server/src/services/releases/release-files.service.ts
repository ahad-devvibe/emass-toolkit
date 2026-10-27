import busboy from "busboy";
import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Readable } from "node:stream";
import {
  Prisma,
  ReleaseFileKind,
  type ReleaseFile,
  type SdkPlatform,
} from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getStorageBuckets } from "../../configs/storage.js";
import {
  uploadFieldsSchema,
  uploadFileNameSchema,
} from "../../schemas/release-files.schema.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { getStorageDriver } from "../storage/drivers/storage.driver.js";
import { stagedKey } from "../storage/storage.utils.js";
import {
  fileFacts,
  storageReader,
  storedInspection,
} from "./file-checks.service.js";
import { evaluateFile, type FileVerdict } from "./file-checks.utils.js";
import { inspectFile } from "./file-inspect/inspect.js";
import {
  checksumMismatch,
  fileBlocked,
  fileNotFound,
  fileTooLarge,
  notReleaseOwner,
  platformTaken,
  releaseLocked,
  releaseNotFound,
  uploadAborted,
} from "./releases.errors.js";
import { presentFile } from "./releases.presenter.js";
import { lockOwnedRelease } from "./releases.service.js";
import { EDITABLE_STATUSES } from "./releases.utils.js";

// Room for boundaries and the small fields on top of the file itself
const MULTIPART_OVERHEAD_BYTES = 1024 ** 2;
const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/;
const FALLBACK_CONTENT_TYPE = "application/octet-stream";
// Deleting a file removes its object while holding the release lock
const DELETE_TRANSACTION_TIMEOUT_MS = 30_000;

interface FilePart {
  /** Fields that arrived before the file part. */
  fields: Record<string, string>;
  file: Readable;
  filename: string;
  mimeType: string;
  /** Resolves once the whole form is parsed; rejects on a trailing problem. */
  finished: Promise<void>;
  /** Stops parsing and drains the rest of the request (early rejection). */
  discard: () => void;
}

const fileMissing = () =>
  ApiError.badRequest("Attach a file to upload", "FILE_MISSING");

/**
 * Streams a multipart upload without buffering it. Resolves on the first
 * file part with the fields sent before it, so "fields before the file" is
 * structural. The file stream errors with FILE_TOO_LARGE past `maxBytes` and
 * with UPLOAD_ABORTED if the client goes away. Anything after the file (a
 * late field, a second file) rejects `finished`.
 */
async function openFilePart(
  req: IncomingMessage,
  maxBytes: number,
): Promise<FilePart> {
  const declared = Number(req.headers["content-length"]);
  if (declared > maxBytes + MULTIPART_OVERHEAD_BYTES) {
    throw fileTooLarge(maxBytes);
  }

  let parser: busboy.Busboy;
  try {
    parser = busboy({
      headers: req.headers,
      defParamCharset: "utf8",
      limits: {
        files: 1,
        fields: 5,
        parts: 6,
        fieldSize: 1024,
        fileSize: maxBytes,
      },
    });
  } catch {
    throw new ApiError(
      415,
      "Upload the file as multipart/form-data",
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }

  return new Promise<FilePart>((resolve, reject) => {
    const fields: Record<string, string> = {};
    let file: Readable | undefined;
    let trailingProblem: ApiError | undefined;
    let settleFinished: (error?: ApiError) => void = () => undefined;
    const finished = new Promise<void>((done, failed) => {
      settleFinished = (error) => (error ? failed(error) : done());
    });
    // A rejection nobody awaits (early failure) must not crash the process
    finished.catch(() => undefined);

    const discard = () => {
      req.unpipe(parser);
      req.resume();
    };
    const fail = (error: ApiError) => {
      if (file) {
        file.destroy(error);
        settleFinished(error);
      } else {
        discard();
        reject(error);
      }
    };

    parser.on("field", (name, value, info) => {
      if (file) {
        trailingProblem ??= ApiError.badRequest(
          "Send every field before the file",
          "FIELDS_AFTER_FILE",
        );
        return;
      }
      if (info.valueTruncated) {
        fail(ApiError.badRequest(`${name} is too long`, "VALIDATION_ERROR"));
        return;
      }
      fields[name] = value;
    });

    parser.on("file", (_name, stream, info) => {
      file = stream;
      stream.on("limit", () => stream.destroy(fileTooLarge(maxBytes)));
      resolve({
        fields,
        file: stream,
        filename: info.filename ?? "",
        mimeType: info.mimeType,
        finished,
        discard,
      });
    });

    parser.on("filesLimit", () => {
      trailingProblem ??= ApiError.badRequest(
        "Send one file per request",
        "TOO_MANY_FILES",
      );
    });
    const tooManyParts = () =>
      fail(ApiError.badRequest("Too many form fields", "VALIDATION_ERROR"));
    parser.on("fieldsLimit", tooManyParts);
    parser.on("partsLimit", tooManyParts);

    parser.on("error", () =>
      fail(
        req.complete
          ? ApiError.badRequest("Invalid multipart upload", "UPLOAD_INVALID")
          : uploadAborted(),
      ),
    );
    parser.on("close", () => {
      if (!file) reject(fileMissing());
      settleFinished(trailingProblem);
    });
    req.on("close", () => {
      if (!req.complete) fail(uploadAborted());
    });

    req.pipe(parser);
  });
}

async function* hashing(
  source: Readable,
  hash: ReturnType<typeof createHash>,
  counter: { bytes: number },
): AsyncGenerator<Buffer> {
  for await (const chunk of source as AsyncIterable<Buffer>) {
    hash.update(chunk);
    counter.bytes += chunk.length;
    yield chunk;
  }
}

/**
 * P2002 on insert: either the same bytes are already in this release
 * (releaseId, sha256) or the platform is taken (releaseId, platform). The
 * existing row says which.
 */
async function translateUploadConflict(
  err: unknown,
  releaseId: string,
  sha256: string,
  platform: SdkPlatform | null | undefined,
): Promise<void> {
  if (
    !(err instanceof Prisma.PrismaClientKnownRequestError) ||
    err.code !== "P2002"
  ) {
    return;
  }
  const twin = await prisma.releaseFile.findFirst({
    where: { releaseId, sha256 },
    select: {
      id: true,
      originalName: true,
      release: { select: { version: true, status: true } },
    },
  });
  if (twin) {
    throw fileBlocked([
      {
        code: "SAME_CONTENT",
        message: `Already in this release as "${twin.originalName}".`,
        match: {
          fileId: twin.id,
          fileName: twin.originalName,
          releaseId,
          version: twin.release.version,
          status: twin.release.status,
          sameRelease: true,
        },
      },
    ]);
  }
  const holder = platform
    ? await prisma.releaseFile.findFirst({
        where: { releaseId, platform },
        select: { id: true },
      })
    : null;
  throw platformTaken(holder?.id);
}

async function deleteOrphan(key: string, releaseId: string): Promise<void> {
  try {
    await getStorageDriver().deleteObject(getStorageBuckets().staging, key);
  } catch (err) {
    logger.error(
      { key, releaseId, err },
      "Orphaned staged object after a failed upload",
    );
  }
}

/**
 * POST /releases/:id/files. Checks everything it can before reading the
 * file, streams it into staging while hashing, then inserts the row under
 * the release lock. Any failure after the object exists deletes it again.
 */
export async function uploadReleaseFile(
  devId: string,
  releaseId: string,
  req: IncomingMessage,
) {
  const part = await openFilePart(req, env.MAX_UPLOAD_BYTES);
  let fields: ReturnType<typeof uploadFieldsSchema.parse>;
  let name: string;
  let target: { id: string; version: string; productId: string };

  try {
    fields = uploadFieldsSchema.parse(part.fields);
    name = uploadFileNameSchema.parse(part.filename);

    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: { files: { select: { id: true, platform: true } } },
    });
    if (!release) throw releaseNotFound();
    if (release.createdById !== devId) throw notReleaseOwner();
    if (!EDITABLE_STATUSES.includes(release.status)) {
      throw releaseLocked(release.status);
    }
    if (
      fields.replace &&
      !release.files.some((file) => file.id === fields.replace)
    ) {
      throw fileNotFound();
    }
    const holder = fields.platform
      ? release.files.find(
          (file) =>
            file.platform === fields.platform && file.id !== fields.replace,
        )
      : undefined;
    if (holder) throw platformTaken(holder.id);
    target = release;
  } catch (err) {
    part.discard();
    throw err;
  }

  const key = stagedKey(target.productId, releaseId, randomUUID(), name);
  const contentType = CONTENT_TYPE.test(part.mimeType)
    ? part.mimeType.toLowerCase()
    : FALLBACK_CONTENT_TYPE;
  const hash = createHash("sha256");
  const counter = { bytes: 0 };
  const { staging } = getStorageBuckets();

  try {
    await getStorageDriver().putStream({
      bucket: staging,
      key,
      contentType,
      fileName: name,
      body: hashing(part.file, hash, counter),
    });
  } catch (err) {
    part.discard();
    throw err;
  }

  const sha256 = hash.digest("hex");
  let committed: { created: ReleaseFile; replaced: ReleaseFile | null };
  let verdict: FileVerdict;
  try {
    await part.finished;
    if (counter.bytes === 0) {
      throw ApiError.badRequest("The file is empty", "EMPTY_FILE");
    }
    if (fields.sha256 !== sha256) throw checksumMismatch();

    // The browser checked this file before sending it; a modified client
    // could skip that, so the stored bytes are judged again here
    const inspection = await inspectFile(
      storageReader(staging, key, counter.bytes),
      name,
    );
    verdict = evaluateFile(
      await fileFacts(target, inspection, sha256, fields.replace),
    );
    if (verdict.reasons.length > 0) {
      throw fileBlocked(verdict.reasons, {
        format: inspection.format,
        versions: inspection.versions,
      });
    }

    committed = await prisma.$transaction(async (tx) => {
      await lockOwnedRelease(tx, releaseId, devId, EDITABLE_STATUSES);
      let old: ReleaseFile | null = null;
      if (fields.replace) {
        old = await tx.releaseFile.findFirst({
          where: { id: fields.replace, releaseId },
        });
        if (!old) throw fileNotFound();
        await tx.releaseFile.delete({ where: { id: old.id } });
      }
      const row = await tx.releaseFile.create({
        data: {
          releaseId,
          // No kind means the type wasn't detected: it's chosen in the editor
          kind: fields.kind ?? null,
          platform:
            fields.kind === ReleaseFileKind.SDK
              ? (fields.platform ?? null)
              : null,
          originalName: name,
          contentType,
          sizeBytes: BigInt(counter.bytes),
          sha256,
          objectKey: key,
          ...storedInspection(inspection),
        },
      });
      return { created: row, replaced: old };
    });
  } catch (err) {
    await deleteOrphan(key, releaseId);
    await translateUploadConflict(err, releaseId, sha256, fields.platform);
    throw err;
  }

  // The new file is in place; the replaced object is never served again
  if (committed.replaced) {
    await deleteOrphan(committed.replaced.objectKey, releaseId);
  }
  return { file: presentFile(committed.created, verdict) };
}

/**
 * Deletes the object, then the row, under the release lock. A failed object
 * delete rolls back; a missing object counts as deleted, so retries are safe.
 */
export async function deleteReleaseFile(
  devId: string,
  releaseId: string,
  fileId: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await lockOwnedRelease(tx, releaseId, devId, EDITABLE_STATUSES);
      const file = await tx.releaseFile.findFirst({
        where: { id: fileId, releaseId },
      });
      if (!file) throw fileNotFound();
      await getStorageDriver().deleteObject(
        getStorageBuckets().staging,
        file.objectKey,
      );
      await tx.releaseFile.delete({ where: { id: fileId } });
    },
    { timeout: DELETE_TRANSACTION_TIMEOUT_MS },
  );
}
