-- CreateEnum
CREATE TYPE "BlockReason" AS ENUM ('COMPETITOR_DOMAIN', 'SIGNUP_REJECTED');

-- CreateEnum
CREATE TYPE "AuthEventType" AS ENUM ('SIGN_IN_SUCCEEDED', 'SIGN_IN_FAILED', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "blockReason" "BlockReason";

-- CreateTable
CREATE TABLE "AuthEvent" (
    "id" TEXT NOT NULL,
    "type" "AuthEventType" NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "code" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthEvent_type_createdAt_idx" ON "AuthEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AuthEvent_userId_createdAt_idx" ON "AuthEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseFile_sha256_idx" ON "ReleaseFile"("sha256");

-- AddForeignKey
ALTER TABLE "AuthEvent" ADD CONSTRAINT "AuthEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: competitor signups are blocked before a password is ever set;
-- rejected free-mail signups already had one
UPDATE "User" SET "blockReason" = 'COMPETITOR_DOMAIN' WHERE "status" = 'BLOCKED' AND "password" IS NULL;
UPDATE "User" SET "blockReason" = 'SIGNUP_REJECTED' WHERE "status" = 'BLOCKED' AND "password" IS NOT NULL;
