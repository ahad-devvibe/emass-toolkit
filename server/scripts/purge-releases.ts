import "dotenv/config";
import { parseArgs } from "node:util";
import { ReleaseStatus } from "@prisma/client";
import { prisma } from "../src/configs/prisma.js";
import { logger } from "../src/configs/logger.js";
import { getStorageBuckets } from "../src/configs/storage.js";
import { lockProductReleases } from "../src/services/releases/releases.service.js";
import {
  VERSION_ORDER_DESC,
  versionOf,
} from "../src/services/releases/releases.utils.js";
import { getStorageDriver } from "../src/services/storage/drivers/storage.driver.js";

// Deletes shipped releases for good, for cleaning up after testing: their
// objects in storage, the release with its files, events and uploads, and
// their download and activity rows. Removing a PUBLISHED release promotes the
// newest remaining ARCHIVED one, as rollback does. A dry run unless --execute;
// it can't be undone, emails no one and leaves HubSpot totals as they are.
//   npm run releases:purge -- --product "EMASS SDK" [--version 1.2.3] [--include-archived] [--execute]
//   npm run releases:purge -- --all [--execute]
const USAGE =
  'usage: npm run releases:purge -- (--product "<name or id>" | --all) [--version x.y.z] [--include-archived] [--execute]';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function options() {
  const { values } = parseArgs({
    options: {
      product: { type: "string" },
      all: { type: "boolean", default: false },
      version: { type: "string" },
      "include-archived": { type: "boolean", default: false },
      execute: { type: "boolean", default: false },
    },
  });
  if (Boolean(values.product) === values.all) throw new Error(USAGE);
  return values;
}

function formatBytes(bytes: bigint): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

async function main(): Promise<boolean> {
  // The plan is the output; dev query logs (LOG_LEVEL=debug) would bury it
  logger.level = "warn";
  const args = options();
  const statuses: ReleaseStatus[] = args["include-archived"]
    ? [
        ReleaseStatus.PUBLISHED,
        ReleaseStatus.ARCHIVED,
        ReleaseStatus.ROLLED_BACK,
      ]
    : [ReleaseStatus.PUBLISHED];

  const product = args.product?.trim();
  const releases = await prisma.release.findMany({
    where: {
      status: { in: statuses },
      ...(args.version && { version: args.version.replace(/^v/, "") }),
      ...(product &&
        (UUID.test(product)
          ? { productId: product }
          : { product: { name: { equals: product, mode: "insensitive" } } })),
    },
    orderBy: [{ product: { name: "asc" } }, ...VERSION_ORDER_DESC],
    include: {
      product: { select: { name: true } },
      files: { select: { id: true, objectKey: true, sizeBytes: true } },
      _count: { select: { files: true } },
    },
  });
  if (releases.length === 0) {
    console.log("purge-releases: nothing matches; nothing to do.");
    return true;
  }

  const buckets = getStorageBuckets();
  const bucketOf = (key: string) =>
    key.startsWith("releases/") ? buckets.release : buckets.staging;
  const removing = new Set(releases.map((release) => release.id));

  // What takes over from each PUBLISHED release that goes
  const restores = new Map<string, { id: string; version: string | null }>();
  for (const release of releases) {
    if (release.status !== ReleaseStatus.PUBLISHED) continue;
    const target = await prisma.release.findFirst({
      where: {
        productId: release.productId,
        status: ReleaseStatus.ARCHIVED,
        id: { notIn: [...removing] },
      },
      orderBy: VERSION_ORDER_DESC,
      select: { id: true, version: true },
    });
    if (target) restores.set(release.id, target);
  }

  let heading = "";
  for (const release of releases) {
    if (release.product.name !== heading) {
      heading = release.product.name;
      console.log(`\n${heading}`);
    }
    const downloads = await prisma.download.count({
      where: {
        OR: [
          { releaseId: release.id },
          { releaseFileId: { in: release.files.map((file) => file.id) } },
        ],
      },
    });
    const bytes = release.files.reduce((sum, file) => sum + file.sizeBytes, 0n);
    console.log(
      `  remove  v${versionOf(release)}  ${release.status}  ${release._count.files} file(s) (${formatBytes(bytes)})  ${downloads} download(s)`,
    );
    for (const file of release.files) {
      console.log(`          ${file.objectKey}  (${bucketOf(file.objectKey)})`);
    }
    const restore = restores.get(release.id);
    if (restore) {
      console.log(`  restore v${versionOf(restore)}  ARCHIVED → PUBLISHED`);
    }
  }

  const objects = releases.reduce((sum, r) => sum + r.files.length, 0);
  if (!args.execute) {
    console.log(
      `\nDry run: ${releases.length} release(s), ${objects} object(s). Re-run with --execute to delete.`,
    );
    return true;
  }

  const driver = getStorageDriver();
  let removed = 0;
  let restored = 0;
  let failed = 0;
  for (const release of releases) {
    const label = `${release.product.name} v${versionOf(release)}`;
    // Objects first: a failure keeps the row, so a re-run retries them
    const results = await Promise.allSettled(
      release.files.map((file) =>
        driver.deleteObject(bucketOf(file.objectKey), file.objectKey),
      ),
    );
    if (results.some((result) => result.status === "rejected")) {
      console.error(
        `purge-releases: ${label}: some objects could not be deleted; kept the release.`,
      );
      failed += 1;
      continue;
    }

    const fileIds = release.files.map((file) => file.id);
    const restore = restores.get(release.id);
    await prisma.$transaction(async (tx) => {
      await lockProductReleases(tx, release.productId);
      await tx.download.deleteMany({
        where: {
          OR: [{ releaseId: release.id }, { releaseFileId: { in: fileIds } }],
        },
      });
      await tx.activityLog.deleteMany({
        where: {
          OR: [{ releaseId: release.id }, { releaseFileId: { in: fileIds } }],
        },
      });
      // Files, events and upload sessions cascade
      await tx.release.delete({ where: { id: release.id } });
      if (restore) {
        await tx.release.update({
          where: { id: restore.id },
          data: { status: ReleaseStatus.PUBLISHED },
        });
      }
    });
    removed += 1;
    console.log(`purge-releases: removed ${label}.`);
    if (restore) {
      restored += 1;
      console.log(
        `purge-releases: ${release.product.name} v${versionOf(restore)} is published again.`,
      );
    }
  }

  console.log(
    `\npurge-releases: removed ${removed}, restored ${restored}, failed ${failed}.`,
  );
  return failed === 0;
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err: unknown) => {
    console.error(
      `purge-releases: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
