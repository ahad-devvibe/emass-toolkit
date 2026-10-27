import type {
  Product,
  Release,
  ReleaseEvent,
  ReleaseFile,
  User,
} from "@prisma/client";
import type { FileVerdict } from "./file-checks.utils.js";

type Actor = Pick<User, "id" | "firstName" | "lastName" | "role">;

/** The user fields a release response may show. */
export const actorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} as const;

export const releaseDetailInclude = {
  product: { select: { id: true, name: true } },
  createdBy: { select: actorSelect },
  publishedBy: { select: actorSelect },
  files: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  events: {
    orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }],
    include: { actor: { select: actorSelect } },
  },
};

export function presentActor(user: Actor) {
  return {
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    role: user.role,
  };
}

const noVerdict: FileVerdict = { reasons: [], warnings: [] };

// sizeBytes is a BigInt column (JSON can't carry it); files are capped far
// below 2^53, so a number is exact. objectKey never leaves the server.
// `blockedBy` lists what stops submit; `warnings` what submit must confirm.
export function presentFile(file: ReleaseFile, verdict = noVerdict) {
  return {
    id: file.id,
    kind: file.kind,
    platform: file.platform,
    name: file.originalName,
    contentType: file.contentType,
    sizeBytes: Number(file.sizeBytes),
    sha256: file.sha256,
    createdAt: file.createdAt,
    format: file.format,
    detectedVersions: file.detectedVersions,
    blockedBy: verdict.reasons,
    warnings: verdict.warnings,
  };
}

type SummaryInput = Release & {
  product: Pick<Product, "id" | "name">;
  createdBy: Actor;
};

export function presentReleaseSummary(
  release: SummaryInput,
  totals: { fileCount: number; totalBytes: number },
) {
  return {
    id: release.id,
    product: release.product,
    version: release.version,
    status: release.status,
    createdBy: presentActor(release.createdBy),
    createdAt: release.createdAt,
    updatedAt: release.updatedAt,
    ...totals,
  };
}

type DetailInput = SummaryInput & {
  publishedBy: Actor | null;
  files: ReleaseFile[];
  events: (ReleaseEvent & { actor: Actor })[];
};

type VersionRef = { id: string; version: string } | null;

/**
 * What the admin's review actions would touch: the published release a
 * publish would archive (while in review) and the archived release a
 * rollback would restore (while published).
 */
export type ReviewContext = {
  currentPublished: VersionRef;
  restoreTarget: VersionRef;
};

export const noReviewContext: ReviewContext = {
  currentPublished: null,
  restoreTarget: null,
};

export function presentRelease(
  release: DetailInput,
  review: ReviewContext = noReviewContext,
  verdicts: Map<string, FileVerdict> = new Map(),
) {
  const files = release.files.map((file) =>
    presentFile(file, verdicts.get(file.id)),
  );
  return {
    ...presentReleaseSummary(release, {
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    }),
    releaseNotes: release.releaseNotes,
    publishedAt: release.publishedAt,
    publishedBy: release.publishedBy && presentActor(release.publishedBy),
    files,
    events: release.events.map((event) => ({
      id: event.id,
      type: event.type,
      actor: presentActor(event.actor),
      note: event.note,
      createdAt: event.createdAt,
    })),
    review,
  };
}
