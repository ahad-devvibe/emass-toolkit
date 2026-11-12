-- A product can be a plain link in the catalog instead of shipping releases.
-- Existing products keep shipping releases.
CREATE TYPE "ProductKind" AS ENUM ('RELEASES', 'LINK');

ALTER TABLE "Product"
  ADD COLUMN "kind" "ProductKind" NOT NULL DEFAULT 'RELEASES',
  ADD COLUMN "linkUrl" TEXT,
  ADD COLUMN "linkLabel" TEXT;
