-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'PUBLISHED', 'ARCHIVED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ReleaseFileKind" AS ENUM ('SDK', 'DOC');

-- CreateEnum
CREATE TYPE "SdkPlatform" AS ENUM ('WINDOWS', 'MACOS', 'UBUNTU');

-- CreateEnum
CREATE TYPE "ReleaseEventType" AS ENUM ('CREATED', 'SUBMITTED', 'WITHDRAWN', 'CHANGES_REQUESTED', 'PUBLISHED', 'ARCHIVED', 'ROLLED_BACK', 'RESTORED', 'NOTES_EDITED');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "detail" TEXT,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "versionMajor" INTEGER NOT NULL,
    "versionMinor" INTEGER NOT NULL,
    "versionPatch" INTEGER NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "releaseNotes" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseFile" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "kind" "ReleaseFileKind" NOT NULL,
    "platform" "SdkPlatform",
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseEvent" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "type" "ReleaseEventType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductResource" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_isActive_sortOrder_idx" ON "Product"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "Release_productId_status_idx" ON "Release"("productId", "status");

-- CreateIndex
CREATE INDEX "Release_status_createdAt_idx" ON "Release"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Release_productId_publishedAt_idx" ON "Release"("productId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Release_productId_version_key" ON "Release"("productId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseFile_objectKey_key" ON "ReleaseFile"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseFile_releaseId_platform_key" ON "ReleaseFile"("releaseId", "platform");

-- CreateIndex
CREATE INDEX "ReleaseEvent_releaseId_createdAt_idx" ON "ReleaseEvent"("releaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductResource_objectKey_key" ON "ProductResource"("objectKey");

-- CreateIndex
CREATE INDEX "ProductResource_productId_idx" ON "ProductResource"("productId");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseFile" ADD CONSTRAINT "ReleaseFile_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductResource" ADD CONSTRAINT "ProductResource_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductResource" ADD CONSTRAINT "ProductResource_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
