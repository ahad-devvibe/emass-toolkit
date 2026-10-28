import {
  Prisma,
  ReleaseFileKind,
  type ReleaseFile,
  type SdkPlatform,
} from "@prisma/client";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getStorageBuckets } from "../../configs/storage.js";
import { getStorageDriver } from "../storage/drivers/storage.driver.js";
import {
  fileFacts,
  storageReader,
  storedInspection,
} from "./file-checks.service.js";
import { evaluateFile, type FileVerdict } from "./file-checks.utils.js";
import { inspectFile } from "./file-inspect/inspect.js";
import {
  fileBlocked,
  fileNotFound,
  notReleaseOwner,
  platformTaken,
  releaseLocked,
  releaseNotFound,
} from "./releases.errors.js";
import { presentFile } from "./releases.presenter.js";
import { lockOwnedRelease } from "./releases.service.js";
import { EDITABLE_STATUSES } from "./releases.utils.js";

// Deleting a file removes its object while holding the release lock
const DELETE_TRANSACTION_TIMEOUT_MS = 30_000;

export interface UploadTargetInput {
  kind?: ReleaseFileKind | null;
  platform?: SdkPlatform | null;
  replace?: string | null;
}

/**
 * The release a new file may go into: it exists, the DEV created it, it's
 * still editable, the file it replaces belongs to it, and no other file holds
 * the platform. Checked before any bytes are stored, and again under the lock
 * when the file is saved.
 */
export async function assertUploadTarget(
  devId: string,
  releaseId: string,
  { platform, replace }: UploadTargetInput,
) {
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    include: { files: { select: { id: true, platform: true } } },
  });
  if (!release) throw releaseNotFound();
  if (release.createdById !== devId) throw notReleaseOwner();
  if (!EDITABLE_STATUSES.includes(release.status)) {
    throw releaseLocked(release.status);
  }
  if (replace && !release.files.some((file) => file.id === replace)) {
    throw fileNotFound();
  }
  const holder = platform
    ? release.files.find(
        (file) => file.platform === platform && file.id !== replace,
      )
    : undefined;
  if (holder) throw platformTaken(holder.id);
  return release;
}

/**
 * P2002 on insert: either the same bytes are already in this release
 * (releaseId, sha256) or the platform is taken (releaseId, platform). The
 * existing row says which.
 */
export async function translateUploadConflict(
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

export async function deleteOrphan(
  key: string,
  releaseId: string,
): Promise<void> {
  try {
    await getStorageDriver().deleteObject(getStorageBuckets().staging, key);
  } catch (err) {
    logger.error(
      { key, releaseId, err },
      "Orphaned staged object after a failed upload",
    );
  }
}

export interface StagedFile {
  key: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** Verified: what arrived is what the browser hashed. */
  sha256: string;
  kind: ReleaseFileKind | null;
  platform: SdkPlatform | null;
  replace: string | null;
}

/**
 * Saves a file whose bytes are already in staging. The stored object is
 * inspected again (a modified client could skip the browser's checks) and
 * the file rules run on it; then the row is inserted under the release lock,
 * replacing the old file if asked. Any failure deletes the staged object.
 */
export async function saveStagedFile(
  devId: string,
  releaseId: string,
  staged: StagedFile,
) {
  const { key, sha256, replace } = staged;
  let committed: { created: ReleaseFile; replaced: ReleaseFile | null };
  let verdict: FileVerdict;
  try {
    const target = await assertUploadTarget(devId, releaseId, staged);
    const inspection = await inspectFile(
      storageReader(getStorageBuckets().staging, key, staged.sizeBytes),
      staged.name,
    );
    verdict = evaluateFile(
      await fileFacts(target, inspection, sha256, replace ?? undefined),
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
      if (replace) {
        old = await tx.releaseFile.findFirst({
          where: { id: replace, releaseId },
        });
        if (!old) throw fileNotFound();
        await tx.releaseFile.delete({ where: { id: old.id } });
      }
      const row = await tx.releaseFile.create({
        data: {
          releaseId,
          // No kind means the type wasn't detected: it's chosen in the editor
          kind: staged.kind,
          platform:
            staged.kind === ReleaseFileKind.SDK ? staged.platform : null,
          originalName: staged.name,
          contentType: staged.contentType,
          sizeBytes: BigInt(staged.sizeBytes),
          sha256,
          objectKey: key,
          ...storedInspection(inspection),
        },
      });
      return { created: row, replaced: old };
    });
  } catch (err) {
    await deleteOrphan(key, releaseId);
    await translateUploadConflict(err, releaseId, sha256, staged.platform);
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
