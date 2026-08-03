-- CreateEnum
CREATE TYPE "HistorySyncStatus" AS ENUM ('NONE', 'PENDING', 'COMPLETE');

-- AlterTable
ALTER TABLE "whatsapp_connections"
  ADD COLUMN "coexistence" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "historySyncStatus" "HistorySyncStatus" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN "customerName" TEXT;

-- AlterTable
ALTER TABLE "messages"
  ADD COLUMN "viaPhoneApp" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isHistorical" BOOLEAN NOT NULL DEFAULT false;
