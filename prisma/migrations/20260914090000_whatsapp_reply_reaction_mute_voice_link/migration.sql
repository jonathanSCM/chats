-- Silenciar una conversación (sonido/notificación, no bloquea el envío)
ALTER TABLE "conversations" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;

-- Responder citando un mensaje puntual
ALTER TABLE "messages" ADD COLUMN "replyToId" TEXT;

-- Reacciones con emoji (chat 1 a 1: alcanza con dos columnas)
ALTER TABLE "messages" ADD COLUMN "customerReaction" TEXT;
ALTER TABLE "messages" ADD COLUMN "staffReaction" TEXT;

-- Distinguir nota de voz (PTT) de un audio subido
ALTER TABLE "messages" ADD COLUMN "isVoiceNote" BOOLEAN NOT NULL DEFAULT false;

-- Preview del primer link del mensaje
ALTER TABLE "messages" ADD COLUMN "linkPreviewTitle" TEXT;
ALTER TABLE "messages" ADD COLUMN "linkPreviewDescription" TEXT;
ALTER TABLE "messages" ADD COLUMN "linkPreviewImageUrl" TEXT;

ALTER TABLE "messages" ADD CONSTRAINT "messages_replyToId_fkey"
  FOREIGN KEY ("replyToId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
