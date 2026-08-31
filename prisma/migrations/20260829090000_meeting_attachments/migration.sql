-- Varios archivos adjuntos por reunión (audio, transcripciones, capturas).
CREATE TABLE "meeting_attachments" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_attachments_meetingId_idx" ON "meeting_attachments"("meetingId");

ALTER TABLE "meeting_attachments" ADD CONSTRAINT "meeting_attachments_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
