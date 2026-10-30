import {
  ReleaseFileFormat,
  ReleaseStatus,
  type Release,
  type ReleaseFile,
} from "@prisma/client";
import { env } from "../../configs/env.js";
import { logger } from "../../configs/logger.js";
import { prisma } from "../../configs/prisma.js";
import { getStorageBuckets } from "../../configs/storage.js";
import type { FileCheckInput } from "../../schemas/release-files.schema.js";
import { ApiError } from "../../utils/api-error.utils.js";
import { getStorageDriver } from "../storage/drivers/storage.driver.js";
import {
  evaluateFile,
  type ContentMatch,
  type FileCheckWarning,
  type FileFacts,
  type FileVerdict,
  type ProductRelease,
} from "./file-checks.utils.js";
import { inspectFile, type Inspection } from "./file-inspect/inspect.js";
import {
  BLOCK_SIZE,
  blockReader,
  NeedBytes,
  READ_BUDGET,
  suppliedReader,
  type ByteRange,
  type RangeReader,
} from "./file-inspect/range-reader.js";
import { versionsInText } from "./file-inspect/versions.js";
import {
  fileBlocked,
  fileNotFound,
  fileTooLarge,
  notReleaseOwner,
  releaseLocked,
  releaseNotFound,
} from "./releases.errors.js";
import { EDITABLE_STATUSES, versionOf } from "./releases.utils.js";

export type FileCheckResult =
  | { status: "NEED_BYTES"; ranges: ByteRange[] }
  | {
      /** The versions pass; send the SHA-256 for the content check. */
      status: "NEED_HASH" | "ALLOWED";
      format: Inspection["format"];
      versions: Inspection["versions"];
      warnings: FileCheckWarning[];
    };

const rangeInvalid = (message: string) =>
  ApiError.badRequest(message, "RANGE_INVALID");

/**
 * The ranges a browser sent, decoded. Each must be one of the block-aligned
 * ranges the server asked for: starting on a block, whole blocks or up to the
 * end of the file, and within it.
 */
function decodeRanges(size: number, ranges: FileCheckInput["ranges"]) {
  let total = 0;
  return ranges.map(({ offset, data }) => {
    const bytes = Buffer.from(data, "base64");
    total += bytes.length;
    if (total > READ_BUDGET) {
      throw ApiError.badRequest(
        `At most ${READ_BUDGET / 1024 ** 2} MiB of ranges per check`,
        "RANGES_TOO_LARGE",
      );
    }
    if (offset % BLOCK_SIZE !== 0) {
      throw rangeInvalid("Range offsets must be multiples of 64 KiB");
    }
    if (bytes.length === 0 || offset + bytes.length > size) {
      throw rangeInvalid("Ranges must lie within the file");
    }
    if (bytes.length % BLOCK_SIZE !== 0 && offset + bytes.length !== size) {
      throw rangeInvalid(
        "Ranges must be whole 64 KiB blocks, or end at the end of the file",
      );
    }
    return { offset, data: new Uint8Array(bytes) };
  });
}

type ReleaseRef = Pick<Release, "id" | "version" | "productId">;

/**
 * Files holding each of these checksums, newest first, with their release:
 * one indexed query however many files are being judged.
 */
async function filesWithContent(release: ReleaseRef, sha256s: string[]) {
  const rows =
    sha256s.length === 0
      ? []
      : await prisma.releaseFile.findMany({
          where: { sha256: { in: [...new Set(sha256s)] } },
          select: {
            id: true,
            sha256: true,
            originalName: true,
            release: { select: { id: true, version: true, status: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
  /** Matches for one file, this release's first, never the file itself. */
  return (sha256: string, excludeFileId?: string): ContentMatch[] =>
    rows
      .filter((row) => row.sha256 === sha256 && row.id !== excludeFileId)
      .map((row) => ({
        fileId: row.id,
        fileName: row.originalName,
        releaseId: row.release.id,
        version: row.release.version,
        status: row.release.status,
        sameRelease: row.release.id === release.id,
      }))
      .sort((a, b) => Number(b.sameRelease) - Number(a.sameRelease));
}

/** The product's other releases at any of these versions, by version. */
async function otherReleasesAt(release: ReleaseRef, versions: string[]) {
  const claimed = [...new Set(versions)].filter((v) => v !== release.version);
  const byVersion = new Map<string, ProductRelease>();
  if (claimed.length === 0) return byVersion;
  const others = await prisma.release.findMany({
    where: {
      productId: release.productId,
      version: { in: claimed },
      id: { not: release.id },
    },
    select: { id: true, version: true, status: true },
  });
  for (const other of others) {
    byVersion.set(versionOf(other), {
      releaseId: other.id,
      status: other.status,
    });
  }
  return byVersion;
}

/**
 * What the rules need from the DB for one file being added: files with the
 * same bytes (`excludeFileId` is a file it replaces) and the product's other
 * releases at any version it claims.
 */
export async function fileFacts(
  release: ReleaseRef,
  inspection: Inspection,
  sha256: string | null,
  excludeFileId?: string,
): Promise<FileFacts> {
  const versions = inspection.versions.map((found) => found.version);
  const [matches, productReleases] = await Promise.all([
    filesWithContent(release, sha256 ? [sha256] : []),
    otherReleasesAt(release, versions),
  ]);
  return {
    releaseVersion: release.version,
    inspection,
    contentMatches: sha256 ? matches(sha256, excludeFileId) : null,
    productReleases,
  };
}

/**
 * POST /releases/:id/files/check: the verdict on a file before it uploads.
 * Stateless: every call re-reads the versions from the ranges it carries and
 * asks for more (NEED_BYTES) until the parser has what it needs. Without a
 * SHA-256 only the version rules run (NEED_HASH); with one, everything does.
 */
export async function checkReleaseFile(
  devId: string,
  releaseId: string,
  input: FileCheckInput,
): Promise<FileCheckResult> {
  if (input.size > env.MAX_UPLOAD_BYTES) {
    throw fileTooLarge(env.MAX_UPLOAD_BYTES);
  }
  const release = await prisma.release.findUnique({
    where: { id: releaseId },
    select: {
      id: true,
      version: true,
      productId: true,
      status: true,
      createdById: true,
      files: { select: { id: true } },
    },
  });
  if (!release) throw releaseNotFound();
  if (release.createdById !== devId) throw notReleaseOwner();
  if (!EDITABLE_STATUSES.includes(release.status)) {
    throw releaseLocked(release.status);
  }
  if (input.replace && !release.files.some((f) => f.id === input.replace)) {
    throw fileNotFound();
  }

  let inspection: Inspection;
  try {
    inspection = await inspectFile(
      suppliedReader(input.size, decodeRanges(input.size, input.ranges)),
      input.name,
    );
  } catch (error) {
    if (error instanceof NeedBytes) {
      return { status: "NEED_BYTES", ranges: error.ranges };
    }
    throw error;
  }

  const { reasons, warnings } = evaluateFile(
    await fileFacts(release, inspection, input.sha256 ?? null, input.replace),
  );
  const summary = { format: inspection.format, versions: inspection.versions };
  if (reasons.length > 0) throw fileBlocked(reasons, summary);
  return {
    status: input.sha256 ? "ALLOWED" : "NEED_HASH",
    ...summary,
    warnings,
  };
}

/** A RangeReader over a stored object: 64 KiB blocks fetched by ranged GETs. */
export function storageReader(
  bucket: string,
  key: string,
  size: number,
): RangeReader {
  const driver = getStorageDriver();
  return blockReader(size, (ranges) =>
    Promise.all(
      ranges.map(({ offset, length }) =>
        driver.readRange(bucket, key, offset, length),
      ),
    ),
  );
}

/** The stored inspection: what was found inside the file when it uploaded. */
export const storedInspection = (inspection: Inspection) => ({
  format: inspection.format,
  detectedVersions: [
    ...new Set(inspection.versions.map((found) => found.version)),
  ],
});

/** Statuses whose files are still judged; shipped releases are settled. */
const JUDGED_STATUSES: ReleaseStatus[] = [
  ...EDITABLE_STATUSES,
  ReleaseStatus.IN_REVIEW,
];

/**
 * Files uploaded before inspection existed carry no format: inspect each once
 * from storage and save the result. An unreadable object is judged by its
 * name only, and isn't saved, so a later read can try again.
 */
async function withInspections(files: ReleaseFile[]) {
  const { staging, release } = getStorageBuckets();
  return Promise.all(
    files.map(async (file) => {
      if (file.format !== null) return file;
      try {
        const bucket = file.objectKey.startsWith("releases/")
          ? release
          : staging;
        const inspection = await inspectFile(
          storageReader(bucket, file.objectKey, Number(file.sizeBytes)),
          file.originalName,
        );
        return await prisma.releaseFile.update({
          where: { id: file.id },
          data: storedInspection(inspection),
        });
      } catch (err) {
        logger.error(
          { fileId: file.id, key: file.objectKey, err },
          "Couldn't inspect a stored release file",
        );
        return {
          ...file,
          format: ReleaseFileFormat.OTHER,
          detectedVersions: versionsInText(file.originalName),
        };
      }
    }),
  );
}

/**
 * The verdict on every file of a release, from what each file said about
 * itself when it uploaded: two queries for the whole release. Only releases
 * still being edited or reviewed are judged; shipped ones get no verdicts.
 * Returns the files too, since older ones may have just been inspected.
 */
export async function releaseFileVerdicts(
  release: ReleaseRef & Pick<Release, "status">,
  files: ReleaseFile[],
): Promise<{ files: ReleaseFile[]; verdicts: Map<string, FileVerdict> }> {
  const verdicts = new Map<string, FileVerdict>();
  if (!JUDGED_STATUSES.includes(release.status) || files.length === 0) {
    return { files, verdicts };
  }
  // The rows as judged: files inspected just now carry their new findings
  const judged = await withInspections(files);
  const [matches, productReleases] = await Promise.all([
    filesWithContent(
      release,
      judged.map((file) => file.sha256),
    ),
    otherReleasesAt(
      release,
      judged.flatMap((file) => file.detectedVersions),
    ),
  ]);
  for (const file of judged) {
    verdicts.set(
      file.id,
      evaluateFile({
        releaseVersion: release.version,
        inspection: {
          format: file.format!,
          versions: file.detectedVersions.map((version) => ({ version })),
          damaged: null,
        },
        contentMatches: matches(file.sha256, file.id),
        productReleases,
      }),
    );
  }
  return { files: judged, verdicts };
}
