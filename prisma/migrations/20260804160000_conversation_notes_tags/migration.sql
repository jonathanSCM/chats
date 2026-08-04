-- Estado, etiquetas y notas internas de conversación.

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'ON_HOLD', 'CLOSED');

ALTER TABLE "conversations"
  ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_notes_conversationId_createdAt_idx" ON "conversation_notes"("conversationId", "createdAt");

ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
