-- CreateEnum
CREATE TYPE "EmailKind" AS ENUM ('RELEASE_WITHDRAWN', 'RELEASE_ANNOUNCED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "kind" "EmailKind" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "batchId" TEXT NOT NULL,
    "userId" TEXT,
    "toEmail" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailOutbox_batchId_status_idx" ON "EmailOutbox"("batchId", "status");

-- CreateIndex
CREATE INDEX "EmailOutbox_sentAt_idx" ON "EmailOutbox"("sentAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_due_idx" ON "EmailOutbox"("priority", "createdAt") WHERE (status IN ('PENDING', 'SENDING'));

-- CreateIndex
CREATE UNIQUE INDEX "EmailOutbox_batchId_toEmail_key" ON "EmailOutbox"("batchId", "toEmail");

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

