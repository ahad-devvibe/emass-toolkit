-- Developers now publish drafts directly, so there is no review step.
-- Anything waiting in review goes back to being a draft.
UPDATE "Release" SET "status" = 'DRAFT'
  WHERE "status" IN ('IN_REVIEW', 'CHANGES_REQUESTED');

ALTER TYPE "ReleaseStatus" RENAME TO "ReleaseStatus_old";
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED', 'ROLLED_BACK');
ALTER TABLE "Release"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ReleaseStatus" USING ("status"::text::"ReleaseStatus"),
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "ReleaseStatus_old";
