-- AlterTable
ALTER TABLE "User" ADD COLUMN     "downloadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "firstDownloadAt" TIMESTAMP(3),
ADD COLUMN     "firstDownloadLabel" TEXT,
ADD COLUMN     "hubspotNoteSentAt" TIMESTAMP(3),
ADD COLUMN     "hubspotSyncedDownloads" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastDownloadAt" TIMESTAMP(3),
ADD COLUMN     "lastDownloadLabel" TEXT;

-- Backfill from existing downloads. Labels read "Product vX.Y.Z: file"; a
-- download whose file was deleted keeps its date without a label.
WITH labelled AS (
  SELECT d."userId", d."createdAt",
         p."name" || ' v' || r."version" || ': ' || f."originalName" AS label
  FROM "Download" d
  LEFT JOIN "ReleaseFile" f ON f."id" = d."releaseFileId"
  LEFT JOIN "Release" r ON r."id" = f."releaseId"
  LEFT JOIN "Product" p ON p."id" = r."productId"
),
totals AS (
  SELECT "userId", COUNT(*)::int AS n FROM "Download" GROUP BY "userId"
),
firsts AS (
  SELECT DISTINCT ON ("userId") "userId", "createdAt", label
  FROM labelled ORDER BY "userId", "createdAt" ASC
),
lasts AS (
  SELECT DISTINCT ON ("userId") "userId", "createdAt", label
  FROM labelled ORDER BY "userId", "createdAt" DESC
)
UPDATE "User" u
SET "downloadCount" = t.n,
    "firstDownloadAt" = fi."createdAt",
    "firstDownloadLabel" = fi.label,
    "lastDownloadAt" = la."createdAt",
    "lastDownloadLabel" = la.label
FROM totals t
JOIN firsts fi ON fi."userId" = t."userId"
JOIN lasts la ON la."userId" = t."userId"
WHERE u."id" = t."userId";
