import { createHash, randomUUID } from "node:crypto";
import { Prisma, type UploadSession } from "@prisma/client";
import { createSHA256 } from "hash-wasm";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getStorageBuckets } from "../../configs/storage.js";
import type { UploadCreateInput } from "../../schemas/upload-sessions.schema.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { getStorageDriver } from "../storage/drivers/storage.driver.js";
import { stagedKey } from "../storage/storage.utils.js";
import {
  checksumMismatch,
  fileBlocked,
  fileTooLarge,
  notReleaseOwner,
  partOutOfOrder,
  partSizeInvalid,
  releaseLocked,
  uploadIncomplete,
  uploadNotFound,
  uploadPartsMismatch,
  uploadSessionMismatch,
} from "./releases.errors.js";
import { assertUploadTarget, saveStagedFile } from "./release-files.service.js";
import { presentFile } from "./releases.presenter.js";
import { EDITABLE_STATUSES } from "./releases.utils.js";
import {
  expectedPartLength,
  isStale,
  nextPart,
  partCount,
  partsToCommit,
  type RecordedPart,
} from "./upload-sessions.utils.js";

const CONTENT_TYPE = /^[\w.+-]+\/[\w.+-]+$/;
const FALLBACK_CONTENT_TYPE = "application/octet-stream";
// A complete that crashed half-way releases its claim after this long
const COMPLETE_CLAIM_MS = 10 * 60 * 1000;

/** What the client needs to (re)start sending parts. */
function presentSession(session: UploadSession) {
  return {
    uploadId: session.id,
    name: session.fileName,
    size: Number(session.sizeBytes),
    sha256: session.declaredSha256,
    partSize: session.partSize,
    partsDone: session.partsDone,
  };
}

const target = (session: UploadSession) => ({
  bucket: getStorageBuckets().staging,
  key: session.objectKey,
  uploadId: session.storageUploadId,
});

/** Aborts the storage upload (best effort) and deletes the session row. */
async function discardSession(session: UploadSession): Promise<void> {
  try {
    await getStorageDriver().abortUpload(target(session));
  } catch (err) {
    // The bucket's lifecycle rule removes uploads that fail to abort
    logger.error(
      { uploadId: session.id, err },
      "Couldn't abort a storage upload",
    );
  }
  await prisma.uploadSession.deleteMany({ where: { id: session.id } });
}

/**
 * Sessions untouched for 24 h are abandoned: abort them. There's no
 * scheduler; this runs whenever a release's uploads are listed or created.
 */
export async function expireStaleSessions(
  releaseId: string,
  now = new Date(),
): Promise<void> {
  const sessions = await prisma.uploadSession.findMany({
    where: { releaseId, completingAt: null },
  });
  await Promise.all(
    sessions
      .filter((session) => isStale(session.updatedAt, now))
      .map(discardSession),
  );
}

/** The DEV's own session on this release, while the release is editable. */
async function ownSession(devId: string, releaseId: string, uploadId: string) {
  const session = await prisma.uploadSession.findFirst({
    where: { id: uploadId, releaseId },
    include: { release: { select: { status: true, createdById: true } } },
  });
  if (!session) throw uploadNotFound();
  if (session.createdById !== devId || session.release.createdById !== devId) {
    throw notReleaseOwner();
  }
  if (!EDITABLE_STATUSES.includes(session.release.status)) {
    throw releaseLocked(session.release.status);
  }
  return session;
}

const sameDetails = (session: UploadSession, input: UploadCreateInput) =>
  session.fileName === input.name &&
  Number(session.sizeBytes) === input.size &&
  session.kind === (input.kind ?? null) &&
  session.platform === (input.platform ?? null) &&
  session.replaceFileId === (input.replace ?? null);

/**
 * POST /releases/:id/uploads. Opens a storage multipart upload and its
 * session, or returns the session already open for the same bytes (that's
 * how a client resumes after losing the id). The browser has already run the
 * full file check; here only what the hash alone decides is checked again.
 */
export async function createUploadSession(
  devId: string,
  releaseId: string,
  input: UploadCreateInput,
) {
  if (input.size > env.MAX_UPLOAD_BYTES) {
    throw fileTooLarge(env.MAX_UPLOAD_BYTES);
  }
  const release = await assertUploadTarget(devId, releaseId, input);
  await expireStaleSessions(releaseId);

  const existing = await prisma.uploadSession.findUnique({
    where: {
      releaseId_declaredSha256: { releaseId, declaredSha256: input.sha256 },
    },
  });
  if (existing) {
    if (!sameDetails(existing, input)) throw uploadSessionMismatch();
    return presentSession(existing);
  }

  // The same bytes twice in one release are never allowed (replacing a file
  // with identical bytes is: the old row goes first)
  const twin = await prisma.releaseFile.findFirst({
    where: {
      releaseId,
      sha256: input.sha256,
      ...(input.replace && { id: { not: input.replace } }),
    },
    select: { id: true, originalName: true },
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
          version: release.version,
          status: release.status,
          sameRelease: true,
        },
      },
    ]);
  }

  const contentType =
    input.contentType && CONTENT_TYPE.test(input.contentType)
      ? input.contentType.toLowerCase()
      : FALLBACK_CONTENT_TYPE;
  const key = stagedKey(randomUUID(), input.name);
  const bucket = getStorageBuckets().staging;
  const storageUploadId = await getStorageDriver().createUpload({
    bucket,
    key,
    contentType,
    fileName: input.name,
  });
  const hasher = await createSHA256();
  hasher.init();

  try {
    const session = await prisma.uploadSession.create({
      data: {
        releaseId,
        createdById: devId,
        objectKey: key,
        storageUploadId,
        fileName: input.name,
        contentType,
        sizeBytes: BigInt(input.size),
        partSize: env.UPLOAD_PART_BYTES,
        hashState: new Uint8Array(hasher.save()),
        declaredSha256: input.sha256,
        kind: input.kind ?? null,
        platform: input.platform ?? null,
        replaceFileId: input.replace ?? null,
      },
    });
    return presentSession(session);
  } catch (err) {
    await getStorageDriver()
      .abortUpload({ bucket, key, uploadId: storageUploadId })
      .catch(() => undefined);
    // Two creates for the same bytes raced: the other one's session wins
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const winner = await prisma.uploadSession.findUnique({
        where: {
          releaseId_declaredSha256: { releaseId, declaredSha256: input.sha256 },
        },
      });
      if (winner && sameDetails(winner, input)) return presentSession(winner);
      throw uploadSessionMismatch();
    }
    throw err;
  }
}

/** GET /releases/:id/uploads: the DEV's open sessions, so a client can rebuild its state. */
export async function listUploadSessions(devId: string, releaseId: string) {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: { createdById: true },
  });
  if (!release) throw uploadNotFound();
  if (release.createdById !== devId) throw notReleaseOwner();
  await expireStaleSessions(releaseId);
  const sessions = await prisma.uploadSession.findMany({
    where: { releaseId, createdById: devId },
    orderBy: { createdAt: "asc" },
  });
  return { uploads: sessions.map(presentSession) };
}

/**
 * PUT /releases/:id/uploads/:uploadId/parts/:n. Parts arrive in order, so the
 * whole-file hash advances with each one and its state is saved with the
 * part. The row only moves on once storage has the part: a crash in between
 * means the client sends it again, which replaces that part in storage.
 */
export async function putUploadPart(
  devId: string,
  releaseId: string,
  uploadId: string,
  n: number,
  body: Buffer,
) {
  const session = await ownSession(devId, releaseId, uploadId);
  const size = Number(session.sizeBytes);
  const count = partCount(size, session.partSize);
  if (n > count) {
    throw ApiError.badRequest(
      `This file has ${count} ${count === 1 ? "part" : "parts"}`,
      "PART_NUMBER_INVALID",
      { parts: count },
    );
  }

  const decision = nextPart(session.partsDone, n);
  if (decision === "stored") return presentSession(session);
  if (decision === "gap") throw partOutOfOrder(session.partsDone + 1);

  const expected = expectedPartLength(size, session.partSize, n);
  if (body.length !== expected) throw partSizeInvalid(expected);

  const hasher = await createSHA256();
  hasher.load(session.hashState);
  hasher.update(body);
  const hashState = new Uint8Array(hasher.save());

  const etag = await getStorageDriver().uploadPart({
    ...target(session),
    partNum: n,
    body,
  });
  // The MD5 lets complete check storage holds these very bytes for part n
  const etags = {
    ...(session.etags as Record<string, RecordedPart>),
    [String(n)]: { etag, md5: createHash("md5").update(body).digest("base64") },
  };

  // Only the request that moves partsDone from n - 1 to n saves; a duplicate
  // that lost the race already sent the same part
  const { count: saved } = await prisma.uploadSession.updateMany({
    where: { id: session.id, partsDone: n - 1 },
    data: { partsDone: n, etags, hashState },
  });
  if (saved === 0) {
    const current = await prisma.uploadSession.findUnique({
      where: { id: session.id },
    });
    if (!current) throw uploadNotFound();
    return presentSession(current);
  }
  return { ...presentSession(session), partsDone: n };
}

/**
 * POST /releases/:id/uploads/:uploadId/complete. Checks the whole-file hash,
 * commits the storage upload, then saves the file exactly as a finished
 * upload always was (inspection, file rules, row under the lock). One request
 * at a time holds the session; a second gets UPLOAD_COMPLETING.
 */
export async function completeUploadSession(
  devId: string,
  releaseId: string,
  uploadId: string,
  now = new Date(),
) {
  const session = await ownSession(devId, releaseId, uploadId);
  const size = Number(session.sizeBytes);
  const count = partCount(size, session.partSize);
  if (session.partsDone < count) throw uploadIncomplete(session.partsDone + 1);

  const { count: claimed } = await prisma.uploadSession.updateMany({
    where: {
      id: session.id,
      OR: [
        { completingAt: null },
        { completingAt: { lt: new Date(now.getTime() - COMPLETE_CLAIM_MS) } },
      ],
    },
    data: { completingAt: now },
  });
  if (claimed === 0) {
    throw ApiError.conflict(
      "This upload is already being saved",
      "UPLOAD_COMPLETING",
    );
  }

  const hasher = await createSHA256();
  hasher.load(session.hashState);
  if (hasher.digest("hex") !== session.declaredSha256) {
    await discardSession(session);
    throw checksumMismatch();
  }

  try {
    // Commit what storage holds now: a part sent twice (e.g. around a refresh)
    // keeps only its latest etag there, whatever the session recorded first
    const listed = await getStorageDriver().listParts(target(session));
    const verdict = partsToCommit(
      listed,
      session.etags as Record<string, RecordedPart>,
      size,
      session.partSize,
    );
    if (!verdict.ok) {
      await discardSession(session);
      throw uploadPartsMismatch(verdict.partNum);
    }
    await getStorageDriver().completeUpload({
      ...target(session),
      parts: verdict.parts,
    });
  } catch (err) {
    if (!(err instanceof ApiError && err.code === "UPLOAD_NOT_FOUND")) {
      // Transient: release the claim so the client can complete again
      await prisma.uploadSession.updateMany({
        where: { id: session.id },
        data: { completingAt: null },
      });
      throw err;
    }
    // Storage no longer knows the upload: an earlier complete committed it
    // and then stopped. If that one also saved the row, we're done.
    const saved = await prisma.releaseFile.findUnique({
      where: { objectKey: session.objectKey },
    });
    if (saved) {
      await prisma.uploadSession.deleteMany({ where: { id: session.id } });
      return { file: presentFile(saved, { reasons: [], warnings: [] }) };
    }
  }

  try {
    return await saveStagedFile(devId, releaseId, {
      key: session.objectKey,
      name: session.fileName,
      contentType: session.contentType,
      sizeBytes: size,
      sha256: session.declaredSha256,
      kind: session.kind,
      platform: session.platform,
      replace: session.replaceFileId,
    });
  } catch (err) {
    // A missing object means the upload is gone for good
    if (err instanceof ApiError && err.code === "SOURCE_NOT_FOUND") {
      throw uploadNotFound();
    }
    throw err;
  } finally {
    // Saved, blocked or failed: saveStagedFile deleted the object on failure,
    // so the session has nothing left to resume
    await prisma.uploadSession.deleteMany({ where: { id: session.id } });
  }
}

/** DELETE /releases/:id/uploads/:uploadId: cancel, discarding the stored parts. */
export async function abortUploadSession(
  devId: string,
  releaseId: string,
  uploadId: string,
) {
  const session = await ownSession(devId, releaseId, uploadId);
  if (session.completingAt) {
    throw ApiError.conflict(
      "This upload is already being saved",
      "UPLOAD_COMPLETING",
    );
  }
  await discardSession(session);
}
