-- AlterTable
ALTER TABLE "messages" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "messages_externalId_key" ON "messages"("externalId");
