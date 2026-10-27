import { Prisma, type ReleaseStatus, type SdkPlatform } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";
import type { FileBlockReason, FileCheckWarning } from "./file-checks.utils.js";
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

export const statusLabels: Record<ReleaseStatus, string> = {
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

/** The file breaks a release-file rule; `reasons` says which (no override). */
export const fileBlocked = (
  reasons: FileBlockReason[],
  details: Record<string, unknown> = {},
) =>
  ApiError.conflict(
    reasons.length === 1
      ? reasons[0].message
      : `This file can't be added: ${reasons.map((r) => r.message).join(" ")}`,
    "FILE_BLOCKED",
    { reasons, ...details },
  );

/** The bytes that arrived aren't the bytes the browser hashed. */
export const checksumMismatch = () =>
  new ApiError(
    422,
    "The file changed or was corrupted on the way. Upload it again.",
    "CHECKSUM_MISMATCH",
  );

export interface FileWarningsByFile {
  fileId: string;
  name: string;
  warnings: FileCheckWarning[];
}

/** Submit needs `confirmWarnings: true` while any file has a warning. */
export const fileWarningsUnconfirmed = (files: FileWarningsByFile[]) =>
  ApiError.conflict(
    `${files.length === 1 ? "A file has" : `${files.length} files have`} warnings. Check them, then submit at your own risk.`,
    "FILE_WARNINGS_UNCONFIRMED",
    { files },
  );

export interface FileReasonsByFile {
  fileId: string;
  name: string;
  reasons: FileBlockReason[];
}

/** Submit refused: these files break a rule (e.g. after a version change). */
export const releaseFilesBlocked = (files: FileReasonsByFile[]) =>
  ApiError.conflict(
    `${files.length === 1 ? `"${files[0].name}" can't` : `${files.length} files can't`} be submitted: ${files
      .flatMap((file) => file.reasons.map((reason) => reason.message))
      .join(" ")}`,
    "FILE_BLOCKED",
    { files },
  );
