import type { ReleaseStatus } from "@prisma/client";
import type { Inspection } from "./file-inspect/inspect.js";
import type { FileFormat } from "./file-inspect/types.js";
import { statusLabels } from "./releases.errors.js";

/** Installers get the strict rules; PDFs and every other file the doc rules. */
export const INSTALLER_FORMATS: readonly FileFormat[] = ["PE", "DEB", "PKG"];

export const isInstaller = (format: FileFormat) =>
  INSTALLER_FORMATS.includes(format);

/** A file that already holds the same bytes. */
export interface ContentMatch {
  fileId: string;
  fileName: string;
  releaseId: string;
  /** Null for a draft that has no version yet. */
  version: string | null;
  status: ReleaseStatus;
  sameRelease: boolean;
}

/** Another release of the product, by its version. */
export interface ProductRelease {
  releaseId: string;
  status: ReleaseStatus;
}

/** Why a file can't be added. There's no override. */
export type FileBlockReason =
  | { code: "DAMAGED"; message: string }
  | { code: "SAME_CONTENT"; message: string; match: ContentMatch }
  | {
      code: "VERSION_MISMATCH";
      message: string;
      version: string;
      fields: string[];
      expected: string;
    }
  | {
      code: "VERSION_EXISTS";
      message: string;
      version: string;
      fields: string[];
      releaseId: string;
      status: ReleaseStatus;
    };

/** Allowed, but the developer confirms these on submit. */
export type FileCheckWarning =
  | { code: "NO_VERSION"; message: string }
  | {
      code: "DOC_VERSION_MISMATCH";
      message: string;
      version: string;
      fields: string[];
      expected: string;
    };

/** One file's verdict: what blocks it, and what the developer must confirm. */
export interface FileVerdict {
  reasons: FileBlockReason[];
  warnings: FileCheckWarning[];
}

export interface FileFacts {
  /** Null while the draft has no version: version rules wait until it has one. */
  releaseVersion: string | null;
  inspection: {
    format: Inspection["format"];
    /** Stored files keep only the versions, so `field` may be missing. */
    versions: { version: string; field?: string }[];
    damaged: string | null;
  };
  /** Files with the same bytes, this release's first; null while unhashed. */
  contentMatches: ContentMatch[] | null;
  /** The product's other releases, keyed by version. */
  productReleases: Map<string, ProductRelease>;
}

/** Each detected version once, with every field that claims it. */
function versionClaims(versions: FileFacts["inspection"]["versions"]) {
  const claims = new Map<string, string[]>();
  for (const { version, field } of versions) {
    const fields = claims.get(version) ?? [];
    if (field && !fields.includes(field)) fields.push(field);
    claims.set(version, fields);
  }
  return claims;
}

/**
 * The verdict on one file. Installers: identical bytes anywhere and any
 * version other than the release's block. Docs: only identical bytes in this
 * release block; another version is a warning. Damaged files always block.
 */
export function evaluateFile(facts: FileFacts): FileVerdict {
  const { releaseVersion: expected, inspection } = facts;
  const reasons: FileBlockReason[] = [];
  const warnings: FileCheckWarning[] = [];
  const installer = isInstaller(inspection.format);

  if (inspection.damaged) {
    reasons.push({ code: "DAMAGED", message: inspection.damaged });
  }

  const match = facts.contentMatches?.find(
    (candidate) => installer || candidate.sameRelease,
  );
  if (match) {
    reasons.push({
      code: "SAME_CONTENT",
      message: match.sameRelease
        ? `Already in this release as "${match.fileName}".`
        : `Identical to "${match.fileName}" in ${match.version ? `v${match.version}` : "a draft without a version"}.`,
      match,
    });
  }

  const claims = versionClaims(inspection.versions);
  // No release version yet: nothing to compare with. Submit judges every
  // file again once the draft has one
  for (const [version, fields] of claims) {
    if (expected === null || version === expected) continue;
    const where = fields.length > 0 ? ` (${fields.join(", ")})` : "";
    const says = `says version ${version}${where}`;
    if (!installer) {
      warnings.push({
        code: "DOC_VERSION_MISMATCH",
        message: `This file ${says}; this release is ${expected}.`,
        version,
        fields,
        expected,
      });
      continue;
    }
    const existing = facts.productReleases.get(version);
    reasons.push(
      existing
        ? {
            code: "VERSION_EXISTS",
            message: `This installer ${says}; v${version} already exists and is ${statusLabels[existing.status]}.`,
            version,
            fields,
            ...existing,
          }
        : {
            code: "VERSION_MISMATCH",
            message: `This installer ${says}; this release is ${expected}.`,
            version,
            fields,
            expected,
          },
    );
  }

  if (claims.size === 0) {
    warnings.push({
      code: "NO_VERSION",
      message: "No version found in this file's name or contents.",
    });
  }
  return { reasons, warnings };
}
