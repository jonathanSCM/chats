CREATE TYPE "MeetingBotStatus" AS ENUM ('PENDING', 'JOINING', 'RECORDING', 'TRANSCRIBING', 'DONE', 'FAILED');

ALTER TABLE "meetings" ADD COLUMN "title" TEXT;
ALTER TABLE "meetings" ADD COLUMN "botStatus" "MeetingBotStatus";
