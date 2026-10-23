import { Prisma, type ReleaseStatus, type SdkPlatform } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";
import type { PlatformDuplicate } from "./releases.utils.js";

export const releaseNotFound = () =>
  ApiError.notFound("Release not found", "RELEASE_NOT_FOUND");

export const productNotFound = () =>
  ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");

export const notReleaseOwner = () =>
  new ApiError(
    403,
    "Only the developer who created this release can change it",
    "NOT_RELEASE_OWNER",
  );

const statusLabels: Record<ReleaseStatus, string> = {
  DRAFT: "a draft",
  IN_REVIEW: "in review",
  CHANGES_REQUESTED: "waiting for changes",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  ROLLED_BACK: "rolled back",
};

export const releaseLocked = (status: ReleaseStatus) =>
  ApiError.conflict(
    `This release is ${statusLabels[status]}, so it can't be changed this way`,
    "RELEASE_LOCKED",
    { status },
  );

export const versionNotNewer = (highestShipped: string) =>
  ApiError.conflict(
    `Version must be newer than ${highestShipped}, the highest version already shipped`,
    "VERSION_NOT_NEWER",
    { highestShipped },
  );

export const noRestoreTarget = () =>
  ApiError.conflict(
    "There's no earlier archived version to restore, so this release can't be rolled back",
    "NO_RESTORE_TARGET",
  );

/** The release's files changed while publish was copying them. */
export const releaseChanged = () =>
  ApiError.conflict(
    "The release changed while it was being published. Publish it again.",
    "RELEASE_CHANGED",
  );

export const fileNotFound = () =>
  ApiError.notFound("File not found in this release", "FILE_NOT_FOUND");

export const platformTaken = (fileId?: string) =>
  ApiError.conflict(
    "This release already has an SDK for that platform",
    "PLATFORM_TAKEN",
    fileId ? { fileId } : undefined,
  );

const platformLabels: Record<SdkPlatform, string> = {
  WINDOWS: "Windows",
  MACOS: "macOS",
  UBUNTU: "Ubuntu",
};

/** Two or more files claim a platform in the mapping being saved. */
export const duplicatePlatform = (duplicates: PlatformDuplicate[]) =>
  ApiError.conflict(
    `${duplicates.map((d) => platformLabels[d.platform]).join(", ")} ${duplicates.length === 1 ? "is" : "are"} set on more than one file. Each platform can have one SDK.`,
    "DUPLICATE_PLATFORM",
    { duplicates },
  );

export const fileTooLarge = (maxBytes: number) =>
  new ApiError(
    413,
    `Files can be at most ${Math.floor(maxBytes / 1024 ** 2)} MiB`,
    "FILE_TOO_LARGE",
    { maxBytes },
  );

export const uploadAborted = () =>
  ApiError.badRequest("The upload was cancelled", "UPLOAD_ABORTED");

/** P2002 on (productId, version) means another release already has it. */
export function translateVersionConflict(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw ApiError.conflict(
      "This product already has a release with that version",
      "VERSION_TAKEN",
    );
  }
}
