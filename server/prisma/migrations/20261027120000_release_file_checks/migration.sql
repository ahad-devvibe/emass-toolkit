-- CreateEnum
CREATE TYPE "ReleaseFileFormat" AS ENUM ('PE', 'DEB', 'PKG', 'PDF', 'OTHER');

-- AlterTable
ALTER TABLE "ReleaseFile" ADD COLUMN     "detectedVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "format" "ReleaseFileFormat";

-- Stop with a readable message instead of a bare unique violation when a
-- release already holds the same bytes twice; remove the extra file first.
DO $$
DECLARE
  duplicates TEXT;
BEGIN
  SELECT string_agg(format('release %s: %s', "releaseId", files), '; ')
  INTO duplicates
  FROM (
    SELECT "releaseId", string_agg("originalName", ', ' ORDER BY "createdAt") AS files
    FROM "ReleaseFile"
    GROUP BY "releaseId", "sha256"
    HAVING count(*) > 1
  ) AS dup;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION 'These releases contain the same file twice; delete one copy of each, then rerun: %', duplicates;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseFile_releaseId_sha256_key" ON "ReleaseFile"("releaseId", "sha256");
