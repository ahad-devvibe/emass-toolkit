import {
  ActivityAction,
  ReleaseStatus,
  UserRole,
  type ReleaseFile,
} from "@prisma/client";
import { env } from "../../configs/env.js";
import { prisma } from "../../configs/prisma.js";
import { getStorageBuckets } from "../../configs/storage.js";
import { ApiError } from "../../utils/api-error.utils.js";
import {
  hubspotService,
  syncDownloadsToHubspot,
  type HubspotClient,
} from "../hubspot/hubspot.service.js";
import { downloadLabel } from "../hubspot/hubspot.utils.js";
import { assertLicenseAccepted } from "../licenses/license.service.js";
import { versionOf } from "../releases/releases.utils.js";
import { getStorageDriver } from "../storage/drivers/storage.driver.js";

// Same visibility as the catalog: current and older shipped releases of
// active products. Drafts, reviews and rolled-back builds are never served.
const DOWNLOADABLE: ReleaseStatus[] = [
  ReleaseStatus.PUBLISHED,
  ReleaseStatus.ARCHIVED,
];

export interface Downloader {
  userId: string;
  role: UserRole;
}

type DownloadedFile = Pick<
  ReleaseFile,
  "id" | "releaseId" | "originalName" | "objectKey"
> & { release: { version: string | null; product: { name: string } } };

const fileSelect = {
  id: true,
  releaseId: true,
  originalName: true,
  objectKey: true,
  release: { select: { version: true, product: { select: { name: true } } } },
} as const;

const fileUnavailable = () =>
  ApiError.notFound("This file isn't available", "FILE_NOT_FOUND");

/**
 * Customers go to Download (who got our files: rollback emails, counts);
 * staff go to ActivityLog, so testing a build never counts as a download.
 */
async function recordDownload(
  user: Downloader,
  file: DownloadedFile,
  staged: boolean,
  hubspot: HubspotClient,
): Promise<void> {
  if (user.role === UserRole.CUSTOMER) {
    const now = new Date();
    const label = downloadLabel({
      productName: file.release.product.name,
      // Customers only get shipped files, which always have a version
      version: versionOf(file.release),
      fileName: file.originalName,
    });
    // The row and the user's totals move together; O(1) however many downloads
    await prisma.$transaction([
      prisma.download.create({
        data: {
          userId: user.userId,
          releaseFileId: file.id,
          releaseId: file.releaseId,
          createdAt: now,
        },
      }),
      // Only the very first click sets "first", even if several race
      prisma.user.updateMany({
        where: { id: user.userId, firstDownloadAt: null },
        data: { firstDownloadAt: now, firstDownloadLabel: label },
      }),
      prisma.user.update({
        where: { id: user.userId },
        data: {
          downloadCount: { increment: 1 },
          lastDownloadAt: now,
          lastDownloadLabel: label,
        },
      }),
    ]);
    // HubSpot gets the stored totals without delaying the link; a failure
    // is picked up by the catch-up sweep
    void syncDownloadsToHubspot(user.userId, hubspot);
    return;
  }
  await prisma.activityLog.create({
    data: {
      actorId: user.userId,
      action: ActivityAction.FILE_DOWNLOADED,
      releaseId: file.releaseId,
      releaseFileId: file.id,
      details: { fileName: file.originalName, staged },
    },
  });
}

/** Mints the link, then records the click; the link is returned only once recorded. */
async function issueLink(
  user: Downloader,
  file: DownloadedFile,
  hubspot: HubspotClient,
) {
  const { staging, release } = getStorageBuckets();
  const staged = file.objectKey.startsWith("staged/");
  if (!staged && !file.objectKey.startsWith("releases/")) {
    throw fileUnavailable();
  }
  const { url, expiresAt } = await getStorageDriver().createReadUrl({
    bucket: staged ? staging : release,
    key: file.objectKey,
    fileName: file.originalName,
    expiresInSeconds: staged
      ? env.STAGED_DOWNLOAD_URL_TTL_SECONDS
      : env.DOWNLOAD_URL_TTL_SECONDS,
  });
  await recordDownload(user, file, staged, hubspot);
  return { url, expiresAt, fileName: file.originalName };
}

/**
 * POST /catalog/files/:fileId/download: shipped files only, for anyone
 * signed in. Never a staged object (shipped files live under releases/).
 */
export async function createDownload(
  user: Downloader,
  fileId: string,
  hubspot: HubspotClient = hubspotService,
) {
  // Customers accept the licence once before their first download
  await assertLicenseAccepted(user.userId, user.role);
  const file = await prisma.releaseFile.findFirst({
    where: {
      id: fileId,
      release: {
        status: { in: DOWNLOADABLE },
        product: { isActive: true },
      },
    },
    select: fileSelect,
  });
  if (!file || !file.objectKey.startsWith("releases/")) {
    throw fileUnavailable();
  }
  return issueLink(user, file, hubspot);
}

/**
 * POST /releases/:id/files/:fileId/download: staff, any release state. A
 * staged file (draft, review) gets a short link to the staging bucket.
 */
export async function createStaffDownload(
  user: Downloader,
  releaseId: string,
  fileId: string,
) {
  const file = await prisma.releaseFile.findFirst({
    where: { id: fileId, releaseId },
    select: fileSelect,
  });
  if (!file) throw fileUnavailable();
  return issueLink(user, file, hubspotService);
}
