import { ReleaseStatus, type Prisma, type SdkPlatform } from "@prisma/client";
import { ApiError } from "../../utils/api-error.utils.js";
import type { KeysetCursor } from "../../utils/cursor.utils.js";

export interface Semver {
  major: number;
  minor: number;
  patch: number;
}

interface VersionColumns {
  versionMajor: number | null;
  versionMinor: number | null;
  versionPatch: number | null;
}

/** A release's parsed version, or null while a draft has none yet. */
export function semverOf(release: VersionColumns): Semver | null {
  const { versionMajor, versionMinor, versionPatch } = release;
  if (versionMajor === null || versionMinor === null || versionPatch === null) {
    return null;
  }
  return { major: versionMajor, minor: versionMinor, patch: versionPatch };
}

/**
 * The version of a release that must have one: submit refuses a draft
 * without, so anything in review or shipped has it. A missing one is a bug.
 */
export function versionOf(release: { version: string | null }): string {
  if (release.version === null) {
    throw new ApiError(500, "Release has no version", "INTERNAL_ERROR");
  }
  return release.version;
}

/** {@link semverOf} for a release that must have a version. */
export function requiredSemver(release: VersionColumns): Semver {
  const semver = semverOf(release);
  if (!semver) {
    throw new ApiError(500, "Release has no version", "INTERNAL_ERROR");
  }
  return semver;
}

// Parts are Int columns; the cap keeps them far from overflow
const MAX_VERSION_PART = 999_999;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Strict MAJOR.MINOR.PATCH (no prefix, no leading zeros); null if invalid. */
export function parseVersion(version: string): Semver | null {
  const match = SEMVER.exec(version);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1).map(Number);
  if ([major, minor, patch].some((part) => part > MAX_VERSION_PART)) {
    return null;
  }
  return { major, minor, patch };
}

export function compareVersions(a: Semver, b: Semver): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function formatVersion({ major, minor, patch }: Semver): string {
  return `${major}.${minor}.${patch}`;
}

/** Next patch, minor and major after `highest` (or after 0.0.0). */
export function suggestVersions(highest: Semver | null) {
  const { major, minor, patch } = highest ?? { major: 0, minor: 0, patch: 0 };
  return {
    patch: formatVersion({ major, minor, patch: patch + 1 }),
    minor: formatVersion({ major, minor: minor + 1, patch: 0 }),
    major: formatVersion({ major: major + 1, minor: 0, patch: 0 }),
  };
}

export interface PlatformDuplicate {
  platform: SdkPlatform;
  fileIds: string[];
}

/** Platforms claimed by more than one file in a release's final mapping. */
export function findDuplicatePlatforms(
  files: Map<string, { platform: SdkPlatform | null }>,
): PlatformDuplicate[] {
  const byPlatform = new Map<SdkPlatform, string[]>();
  for (const [fileId, { platform }] of files) {
    if (platform)
      byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), fileId]);
  }
  return [...byPlatform]
    .filter(([, fileIds]) => fileIds.length > 1)
    .map(([platform, fileIds]) => ({ platform, fileIds }));
}

/** Statuses that count as "shipped" for the newer-than rule. */
export const SHIPPED_STATUSES: ReleaseStatus[] = [
  ReleaseStatus.PUBLISHED,
  ReleaseStatus.ARCHIVED,
  ReleaseStatus.ROLLED_BACK,
];

/** Statuses in which the creator can still edit, upload, submit or delete. */
export const EDITABLE_STATUSES: ReleaseStatus[] = [
  ReleaseStatus.DRAFT,
  ReleaseStatus.CHANGES_REQUESTED,
];

/** Highest version first, for "highest shipped" lookups. */
export const VERSION_ORDER_DESC: Prisma.ReleaseOrderByWithRelationInput[] = [
  { versionMajor: "desc" },
  { versionMinor: "desc" },
  { versionPatch: "desc" },
];

/** Releases with a lower version than `version`, compared part by part. */
export function versionBelow({
  major,
  minor,
  patch,
}: Semver): Prisma.ReleaseWhereInput {
  return {
    OR: [
      { versionMajor: { lt: major } },
      { versionMajor: major, versionMinor: { lt: minor } },
      { versionMajor: major, versionMinor: minor, versionPatch: { lt: patch } },
    ],
  };
}

/** Rows strictly after the cursor in (createdAt desc, id desc) order. */
export function afterCursor(cursor: KeysetCursor): Prisma.ReleaseWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}

/**
 * Every whitespace-separated term must match the version, the product name
 * or the creator's name, so "core 2.5" and "jane" both work. Case-insensitive.
 */
export function releaseSearchWhere(
  q: string | undefined,
): Prisma.ReleaseWhereInput {
  const terms = q?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (terms.length === 0) return {};
  return {
    AND: terms.map((term) => {
      const contains = { contains: term, mode: "insensitive" as const };
      return {
        OR: [
          { version: contains },
          { product: { name: contains } },
          { createdBy: { firstName: contains } },
          { createdBy: { lastName: contains } },
        ],
      };
    }),
  };
}
