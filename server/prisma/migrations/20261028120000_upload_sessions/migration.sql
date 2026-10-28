-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "storageUploadId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "partSize" INTEGER NOT NULL,
    "partsDone" INTEGER NOT NULL DEFAULT 0,
    "etags" JSONB NOT NULL DEFAULT '{}',
    "hashState" BYTEA NOT NULL,
    "declaredSha256" TEXT NOT NULL,
    "kind" "ReleaseFileKind",
    "platform" "SdkPlatform",
    "replaceFileId" TEXT,
    "completingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_objectKey_key" ON "UploadSession"("objectKey");

-- CreateIndex
CREATE INDEX "UploadSession_updatedAt_idx" ON "UploadSession"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UploadSession_releaseId_declaredSha256_key" ON "UploadSession"("releaseId", "declaredSha256");

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadSession" ADD CONSTRAINT "UploadSession_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
