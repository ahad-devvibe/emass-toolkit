import {
  ReleaseEventType,
  ReleaseFileKind,
  ReleaseStatus,
  UserRole,
  type Prisma,
  type Release,
  type SdkPlatform,
} from "@prisma/client";
import { prisma } from "../../configs/prisma.js";
import { getStorageBuckets } from "../../configs/storage.js";
import type { SubmitReleaseInput } from "../../schemas/releases.schema.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { decodeCursor, encodeCursor } from "../../utils/cursor.utils.js";
import { getStorageDriver } from "../storage/drivers/storage.driver.js";
import { emailService, type EmailSender } from "../email/email.service.js";
import { releaseFileVerdicts } from "./file-checks.service.js";
import { startRollbackNotifications } from "./rollback-notify.service.js";
import {
  duplicatePlatform,
  fileNotFound,
  fileWarningsUnconfirmed,
  notReleaseOwner,
  productNotFound,
  releaseFilesBlocked,
  releaseLocked,
  releaseNotFound,
  translateVersionConflict,
  versionNotNewer,
} from "./releases.errors.js";
import {
  actorSelect,
  noReviewContext,
  presentRelease,
  presentReleaseSummary,
  releaseDetailInclude,
  type ReviewContext,
} from "./releases.presenter.js";
import {
  EDITABLE_STATUSES,
  SHIPPED_STATUSES,
  VERSION_ORDER_DESC,
  afterCursor,
  compareVersions,
  findDuplicatePlatforms,
  formatVersion,
  parseVersion,
  releaseSearchWhere,
  suggestVersions,
  versionBelow,
  type Semver,
} from "./releases.utils.js";

type Db = Prisma.TransactionClient;

// Deleting a release removes its staged objects while holding the row lock
const DELETE_TRANSACTION_TIMEOUT_MS = 60_000;
const SUBMIT_TRANSACTION_TIMEOUT_MS = 30_000;

function requireVersion(version: string): Semver {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw ApiError.badRequest(
      "Version must look like 1.2.3",
      "VALIDATION_ERROR",
    );
  }
  return parsed;
}

const versionColumns = ({ major, minor, patch }: Semver) => ({
  version: formatVersion({ major, minor, patch }),
  versionMajor: major,
  versionMinor: minor,
  versionPatch: patch,
});

async function assertActiveProduct(productId: string): Promise<void> {
  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });
  if (!product) throw productNotFound();
}

async function highestVersion(
  db: Db,
  productId: string,
  statuses?: ReleaseStatus[],
): Promise<Semver | null> {
  const row = await db.release.findFirst({
    where: { productId, ...(statuses && { status: { in: statuses } }) },
    orderBy: VERSION_ORDER_DESC,
    select: { versionMajor: true, versionMinor: true, versionPatch: true },
  });
  return row
    ? {
        major: row.versionMajor,
        minor: row.versionMinor,
        patch: row.versionPatch,
      }
    : null;
}

export async function assertNewerThanShipped(
  db: Db,
  productId: string,
  version: Semver,
): Promise<void> {
  const shipped = await highestVersion(db, productId, SHIPPED_STATUSES);
  if (shipped && compareVersions(version, shipped) <= 0) {
    throw versionNotNewer(formatVersion(shipped));
  }
}

/**
 * Locks the release row (FOR UPDATE) for the rest of the transaction, then
 * checks it exists, belongs to `devId` and is in one of `allowed`. Every
 * mutation goes through here, so concurrent edits, submits, deletes and
 * uploads on one release are serialised.
 */
async function lockedRow(tx: Db, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Release" WHERE "id" = ${id} FOR UPDATE`;
  const release = await tx.release.findUnique({ where: { id } });
  if (!release) throw releaseNotFound();
  return release;
}

export async function lockOwnedRelease(
  tx: Db,
  id: string,
  devId: string,
  allowed: ReleaseStatus[],
) {
  const release = await lockedRow(tx, id);
  if (release.createdById !== devId) throw notReleaseOwner();
  if (!allowed.includes(release.status)) throw releaseLocked(release.status);
  return release;
}

/** The admin variant (review actions): same lock and status check, no ownership. */
export async function lockRelease(
  tx: Db,
  id: string,
  allowed: ReleaseStatus[],
) {
  const release = await lockedRow(tx, id);
  if (!allowed.includes(release.status)) throw releaseLocked(release.status);
  return release;
}

/**
 * Locks every release of a product. Anything that changes which release is
 * PUBLISHED (rollback, publish) takes this first, so two of them can't race;
 * the target row is locked again inside it, never before it.
 */
export async function lockProductReleases(
  tx: Db,
  productId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "Release" WHERE "productId" = ${productId} FOR UPDATE`;
}

async function withVersionConflicts<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    translateVersionConflict(err);
    throw err;
  }
}

export interface ListReleasesInput {
  status?: ReleaseStatus[];
  productId?: string;
  q?: string;
  cursor?: string;
  limit: number;
}

/**
 * Newest first, keyset-paginated on (createdAt, id). `counts` has every
 * status (zeros included) for the product and search filters, ignoring the
 * status filter, so the tabs can show their totals. `needsYou` ignores every
 * filter: what waits for the caller (an admin's reviews, a dev's own releases
 * sent back with changes requested), for the sidebar badge.
 */
export async function listReleases(
  { status, productId, q, cursor, limit }: ListReleasesInput,
  user: { userId: string; role: UserRole },
) {
  const scope: Prisma.ReleaseWhereInput = {
    ...(productId && { productId }),
    ...releaseSearchWhere(q),
  };
  const filter = status?.length
    ? { AND: [scope, { status: { in: status } }] }
    : scope;
  const page = cursor
    ? { AND: [filter, afterCursor(decodeCursor(cursor))] }
    : filter;

  const waiting: Prisma.ReleaseWhereInput =
    user.role === UserRole.ADMIN
      ? { status: ReleaseStatus.IN_REVIEW }
      : {
          status: ReleaseStatus.CHANGES_REQUESTED,
          createdById: user.userId,
        };

  const [rows, grouped, needsYou] = await Promise.all([
    prisma.release.findMany({
      where: page,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: {
        product: { select: { id: true, name: true } },
        createdBy: { select: actorSelect },
      },
    }),
    prisma.release.groupBy({
      by: ["status"],
      where: scope,
      _count: { _all: true },
    }),
    prisma.release.count({ where: waiting }),
  ]);

  const hasMore = rows.length > limit;
  const releases = hasMore ? rows.slice(0, limit) : rows;
  const fileTotals = await prisma.releaseFile.groupBy({
    by: ["releaseId"],
    where: { releaseId: { in: releases.map((release) => release.id) } },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  const totalsById = new Map(
    fileTotals.map((row) => [
      row.releaseId,
      {
        fileCount: row._count._all,
        totalBytes: Number(row._sum.sizeBytes ?? 0n),
      },
    ]),
  );

  const counts = Object.fromEntries(
    Object.values(ReleaseStatus).map((value) => [value, 0]),
  ) as Record<ReleaseStatus, number>;
  for (const row of grouped) counts[row.status] = row._count._all;

  const last = releases.at(-1);
  return {
    releases: releases.map((release) =>
      presentReleaseSummary(
        release,
        totalsById.get(release.id) ?? { fileCount: 0, totalBytes: 0 },
      ),
    ),
    nextCursor: hasMore && last ? encodeCursor(last) : null,
    counts,
    needsYou,
  };
}

const versionRef = { id: true, version: true } as const;

/** The newest ARCHIVED release of the product below `release`'s version. */
function findRestoreTarget(
  db: Db,
  release: Pick<
    Release,
    "productId" | "versionMajor" | "versionMinor" | "versionPatch"
  >,
) {
  return db.release.findFirst({
    where: {
      productId: release.productId,
      status: ReleaseStatus.ARCHIVED,
      ...versionBelow({
        major: release.versionMajor,
        minor: release.versionMinor,
        patch: release.versionPatch,
      }),
    },
    orderBy: VERSION_ORDER_DESC,
    select: versionRef,
  });
}

async function reviewContext(
  release: Pick<
    Release,
    "status" | "productId" | "versionMajor" | "versionMinor" | "versionPatch"
  >,
): Promise<ReviewContext> {
  // In review: what publishing would archive. Archived: what customers are
  // pointed to if this version is rolled back.
  if (
    release.status === ReleaseStatus.IN_REVIEW ||
    release.status === ReleaseStatus.ARCHIVED
  ) {
    const currentPublished = await prisma.release.findFirst({
      where: { productId: release.productId, status: ReleaseStatus.PUBLISHED },
      select: versionRef,
    });
    return { ...noReviewContext, currentPublished };
  }
  if (release.status === ReleaseStatus.PUBLISHED) {
    return {
      ...noReviewContext,
      restoreTarget: await findRestoreTarget(prisma, release),
    };
  }
  return noReviewContext;
}

export async function getRelease(id: string) {
  const release = await prisma.release.findUnique({
    where: { id },
    include: releaseDetailInclude,
  });
  if (!release) throw releaseNotFound();
  const { files, verdicts } = await releaseFileVerdicts(release, release.files);
  return presentRelease(
    { ...release, files },
    await reviewContext(release),
    verdicts,
  );
}

/**
 * Suggestions start after the highest version of any release of the product
 * (drafts included), so a suggestion is never already taken.
 */
export async function nextVersion(productId: string) {
  await assertActiveProduct(productId);
  const [shipped, highest] = await Promise.all([
    highestVersion(prisma, productId, SHIPPED_STATUSES),
    highestVersion(prisma, productId),
  ]);
  return {
    highestShipped: shipped && formatVersion(shipped),
    suggestions: suggestVersions(highest),
  };
}

export interface CreateReleaseInput {
  productId: string;
  version: string;
  releaseNotes?: string;
}

export async function createRelease(devId: string, input: CreateReleaseInput) {
  const version = requireVersion(input.version);
  await assertActiveProduct(input.productId);
  await assertNewerThanShipped(prisma, input.productId, version);

  const release = await withVersionConflicts(() =>
    prisma.$transaction(async (tx) => {
      const created = await tx.release.create({
        data: {
          productId: input.productId,
          ...versionColumns(version),
          releaseNotes: input.releaseNotes ?? "",
          createdById: devId,
        },
      });
      await tx.releaseEvent.create({
        data: {
          releaseId: created.id,
          type: ReleaseEventType.CREATED,
          actorId: devId,
        },
      });
      return created;
    }),
  );
  return getRelease(release.id);
}

export interface FileMappingInput {
  id: string;
  kind: ReleaseFileKind | null;
  platform?: SdkPlatform | null;
}

export interface UpdateReleaseInput {
  version?: string;
  releaseNotes?: string;
  files?: FileMappingInput[];
}

/**
 * Applies type/platform mappings saved with the draft. The final state of
 * every file is checked as a whole, so swaps are fine and only a real
 * duplicate fails. Changed files lose their platform first and get the
 * final one after, so the (releaseId, platform) index never sees a swap
 * half done.
 */
async function applyFileMappings(
  tx: Db,
  releaseId: string,
  mappings: FileMappingInput[],
): Promise<void> {
  if (mappings.length === 0) return;
  const files = await tx.releaseFile.findMany({
    where: { releaseId },
    select: { id: true, kind: true, platform: true },
  });
  const stored = new Map(files.map((file) => [file.id, file]));
  if (mappings.some((mapping) => !stored.has(mapping.id))) throw fileNotFound();

  const final = new Map(
    files.map((file) => [
      file.id,
      { kind: file.kind, platform: file.platform },
    ]),
  );
  for (const mapping of mappings) {
    final.set(mapping.id, {
      kind: mapping.kind,
      platform:
        mapping.kind === ReleaseFileKind.SDK
          ? (mapping.platform ?? null)
          : null,
    });
  }
  const duplicates = findDuplicatePlatforms(final);
  if (duplicates.length > 0) throw duplicatePlatform(duplicates);

  const changed = mappings
    .map((mapping) => mapping.id)
    .filter((fileId) => {
      const before = stored.get(fileId)!;
      const after = final.get(fileId)!;
      return before.kind !== after.kind || before.platform !== after.platform;
    });
  if (changed.length === 0) return;

  await tx.releaseFile.updateMany({
    where: { id: { in: changed } },
    data: { platform: null },
  });
  for (const fileId of changed) {
    await tx.releaseFile.update({
      where: { id: fileId },
      data: final.get(fileId)!,
    });
  }
}

/** Draft edits add no events (see tasks/release-management.md). */
export async function updateRelease(
  devId: string,
  id: string,
  input: UpdateReleaseInput,
) {
  await withVersionConflicts(() =>
    prisma.$transaction(async (tx) => {
      const release = await lockOwnedRelease(tx, id, devId, EDITABLE_STATUSES);
      await applyFileMappings(tx, id, input.files ?? []);
      const data: Prisma.ReleaseUpdateInput = {};
      if (input.releaseNotes !== undefined) {
        data.releaseNotes = input.releaseNotes;
      }
      if (input.version !== undefined && input.version !== release.version) {
        const version = requireVersion(input.version);
        await assertNewerThanShipped(tx, release.productId, version);
        Object.assign(data, versionColumns(version));
      }
      await tx.release.update({ where: { id }, data });
    }),
  );
  return getRelease(id);
}

/**
 * What submit and publish both require: at least one file, a type on every
 * file and a platform on every SDK, and a version still newer than anything
 * shipped (checked again at publish, since another release may have shipped).
 */
export async function assertReadyForReview(
  db: Db,
  release: Pick<
    Release,
    "id" | "productId" | "versionMajor" | "versionMinor" | "versionPatch"
  >,
): Promise<void> {
  const files = await db.releaseFile.findMany({
    where: { releaseId: release.id },
    select: { kind: true, platform: true },
  });
  if (files.length === 0) {
    throw ApiError.badRequest(
      "Add at least one file before submitting",
      "NO_FILES",
    );
  }
  if (files.some((f) => f.kind === null)) {
    throw ApiError.badRequest(
      "Choose a type for every file",
      "FILE_TYPE_MISSING",
    );
  }
  if (files.some((f) => f.kind === ReleaseFileKind.SDK && !f.platform)) {
    throw ApiError.badRequest(
      "Every SDK file needs a platform",
      "SDK_PLATFORM_MISSING",
    );
  }
  await assertNewerThanShipped(db, release.productId, {
    major: release.versionMajor,
    minor: release.versionMinor,
    patch: release.versionPatch,
  });
}

/**
 * Sends a draft for review. Every file is judged again first (the version
 * may have changed since upload): a blocked file refuses the submit, and
 * warnings need `confirmWarnings`, which the SUBMITTED event records.
 */
export async function submitRelease(
  devId: string,
  id: string,
  input: SubmitReleaseInput = {},
) {
  await prisma.$transaction(
    async (tx) => {
      const release = await lockOwnedRelease(tx, id, devId, EDITABLE_STATUSES);
      await assertReadyForReview(tx, release);
      const files = await tx.releaseFile.findMany({
        where: { releaseId: id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const { verdicts } = await releaseFileVerdicts(release, files);
      const judged = files.map((file) => ({
        fileId: file.id,
        name: file.originalName,
        ...(verdicts.get(file.id) ?? { reasons: [], warnings: [] }),
      }));

      const blocked = judged.filter((file) => file.reasons.length > 0);
      if (blocked.length > 0) {
        throw releaseFilesBlocked(
          blocked.map(({ fileId, name, reasons }) => ({
            fileId,
            name,
            reasons,
          })),
        );
      }
      const warned = judged.filter((file) => file.warnings.length > 0);
      if (warned.length > 0 && !input.confirmWarnings) {
        throw fileWarningsUnconfirmed(
          warned.map(({ fileId, name, warnings }) => ({
            fileId,
            name,
            warnings,
          })),
        );
      }

      await tx.release.update({
        where: { id },
        data: { status: ReleaseStatus.IN_REVIEW },
      });
      await tx.releaseEvent.create({
        data: {
          releaseId: id,
          type: ReleaseEventType.SUBMITTED,
          actorId: devId,
          note:
            warned.length > 0
              ? `Submitted with warnings: ${warned
                  .map(
                    (file) =>
                      `${file.name}: ${file.warnings.map((w) => w.message).join(" ")}`,
                  )
                  .join("; ")}`
              : null,
        },
      });
    },
    // Files uploaded before inspection existed are read from storage once
    { timeout: SUBMIT_TRANSACTION_TIMEOUT_MS },
  );
  return getRelease(id);
}

export async function withdrawRelease(devId: string, id: string) {
  await prisma.$transaction(async (tx) => {
    await lockOwnedRelease(tx, id, devId, [ReleaseStatus.IN_REVIEW]);
    await tx.release.update({
      where: { id },
      data: { status: ReleaseStatus.DRAFT },
    });
    await tx.releaseEvent.create({
      data: { releaseId: id, type: ReleaseEventType.WITHDRAWN, actorId: devId },
    });
  });
  return getRelease(id);
}

/**
 * Fix or extend the notes of a PUBLISHED release (the creating DEV or any
 * ADMIN). Customers see the change at once, so every real edit is logged as
 * NOTES_EDITED; saving the same text again changes nothing.
 */
export async function updatePublishedNotes(
  user: { userId: string; role: UserRole },
  id: string,
  releaseNotes: string,
) {
  await prisma.$transaction(async (tx) => {
    const release = await lockRelease(tx, id, [ReleaseStatus.PUBLISHED]);
    if (user.role !== UserRole.ADMIN && release.createdById !== user.userId) {
      throw notReleaseOwner();
    }
    if (release.releaseNotes === releaseNotes) return;
    await tx.release.update({ where: { id }, data: { releaseNotes } });
    await tx.releaseEvent.create({
      data: {
        releaseId: id,
        type: ReleaseEventType.NOTES_EDITED,
        actorId: user.userId,
      },
    });
  });
  return getRelease(id);
}

/** ADMIN: send a release in review back to its developer with feedback. */
export async function requestChanges(
  adminId: string,
  id: string,
  note: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockRelease(tx, id, [ReleaseStatus.IN_REVIEW]);
    await tx.release.update({
      where: { id },
      data: { status: ReleaseStatus.CHANGES_REQUESTED },
    });
    await tx.releaseEvent.create({
      data: {
        releaseId: id,
        type: ReleaseEventType.CHANGES_REQUESTED,
        actorId: adminId,
        note,
      },
    });
  });
  return getRelease(id);
}

/**
 * ADMIN: pull a published release and put the newest older archived release
 * back in its place, in one transaction under the product lock. Nothing is
 * copied or deleted: both releases' files stay in the release bucket.
 * Emailing the bad build's downloaders waits for download tracking.
 */
export async function rollbackRelease(
  adminId: string,
  id: string,
  { reason, customerMessage }: { reason: string; customerMessage?: string },
  sender: EmailSender = emailService,
) {
  const found = await prisma.release.findUnique({
    where: { id },
    select: { productId: true },
  });
  if (!found) throw releaseNotFound();

  // Customer-facing versions only: the published one, or an older archived one
  const outcome = await prisma.$transaction(async (tx) => {
    await lockProductReleases(tx, found.productId);
    const release = await lockRelease(tx, id, [
      ReleaseStatus.PUBLISHED,
      ReleaseStatus.ARCHIVED,
    ]);

    await tx.release.update({
      where: { id },
      data: { status: ReleaseStatus.ROLLED_BACK },
    });
    await tx.releaseEvent.create({
      data: {
        releaseId: id,
        type: ReleaseEventType.ROLLED_BACK,
        actorId: adminId,
        note: reason,
      },
    });

    if (release.status === ReleaseStatus.ARCHIVED) {
      // Withdrawn only; the published release is untouched
      const current = await tx.release.findFirst({
        where: { productId: found.productId, status: ReleaseStatus.PUBLISHED },
        select: versionRef,
      });
      return { version: release.version, replacement: current };
    }

    // Published: promote the newest older archived version, if there is one;
    // otherwise the product simply has no published release
    const target = await findRestoreTarget(tx, release);
    if (target) {
      // The restored release keeps its original publishedAt; the event dates the restore
      await tx.release.update({
        where: { id: target.id },
        data: { status: ReleaseStatus.PUBLISHED },
      });
      await tx.releaseEvent.create({
        data: {
          releaseId: target.id,
          type: ReleaseEventType.RESTORED,
          actorId: adminId,
          note: `Restored after v${release.version} was rolled back`,
        },
      });
    }
    return { version: release.version, replacement: target };
  });

  // Emails go out after the commit, without holding up the admin
  startRollbackNotifications(
    {
      releaseId: id,
      productId: found.productId,
      withdrawnVersion: outcome.version,
      replacementVersion: outcome.replacement?.version ?? null,
      customerMessage,
      actorId: adminId,
    },
    sender,
  );
  return getRelease(id);
}

/**
 * Deletes the staged objects, then the row (files and events cascade), all
 * under the row lock so no upload can land in between. A failed object
 * delete rolls back and leaves the release intact; retrying is safe because
 * a missing object counts as deleted.
 */
export async function deleteRelease(devId: string, id: string): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await lockOwnedRelease(tx, id, devId, EDITABLE_STATUSES);
      const files = await tx.releaseFile.findMany({
        where: { releaseId: id },
        select: { objectKey: true },
      });
      const { staging } = getStorageBuckets();
      const driver = getStorageDriver();
      await Promise.all(
        files.map((file) => driver.deleteObject(staging, file.objectKey)),
      );
      await tx.release.delete({ where: { id } });
    },
    { timeout: DELETE_TRANSACTION_TIMEOUT_MS },
  );
}
