/*
  Warnings:

  - A unique constraint covering the columns `[hubspotContactId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hubspotContactId" TEXT,
ADD COLUMN     "hubspotSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "User_hubspotContactId_key" ON "User"("hubspotContactId");
