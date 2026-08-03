-- Asignación de conversaciones a vendedores + estado de lectura por usuario

ALTER TABLE "conversations" ADD COLUMN "assignedToId" TEXT;
ALTER TABLE "messages" ADD COLUMN "sentById" TEXT;

CREATE TABLE "conversation_reads" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_reads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_reads_conversationId_userId_key" ON "conversation_reads"("conversationId", "userId");

CREATE INDEX "conversations_assignedToId_idx" ON "conversations"("assignedToId");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_reads" ADD CONSTRAINT "conversation_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
