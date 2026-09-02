ALTER TYPE "MeetingBotStatus" ADD VALUE 'RECORDED';

ALTER TABLE "meetings" ADD COLUMN "botJoinedAt" TIMESTAMP(3);
ALTER TABLE "meetings" ADD COLUMN "botLeftAt" TIMESTAMP(3);
ALTER TABLE "meetings" ADD COLUMN "transcript" TEXT;
