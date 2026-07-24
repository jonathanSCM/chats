"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import { decrypt } from "@/lib/crypto";
import { sendTextMessage } from "@/server/services/whatsapp";
import type { ActionState } from "./bots";

async function getOwnedConversation(botId: string, conversationId: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation || conversation.botId !== botId) return null;
  return conversation;
}

export async function setConversationPausedAction(
  botId: string,
  conversationId: string,
  paused: boolean,
): Promise<ActionState> {
  await requireBotAccess(botId);
  const conversation = await getOwnedConversation(botId, conversationId);
  if (!conversation) return { error: "Conversación no encontrada" };

  await prisma.conversation.update({ where: { id: conversationId }, data: { botPaused: paused } });

  revalidatePath(`/dashboard/bots/${botId}/conversations/${conversationId}`);
  revalidatePath(`/dashboard/bots/${botId}`);
  return { error: null };
}

const messageSchema = z.object({ content: z.string().min(1, "Escribe un mensaje").max(4000) });

export async function sendManualMessageAction(
  botId: string,
  conversationId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireBotAccess(botId);

  const conversation = await getOwnedConversation(botId, conversationId);
  if (!conversation) return { error: "Conversación no encontrada" };
  if (!conversation.botPaused) {
    return { error: "Toma la conversación antes de responder manualmente." };
  }

  const parsed = messageSchema.safeParse({ content: formData.get("content") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const connection = await prisma.whatsAppConnection.findUnique({ where: { botId } });
  if (!connection?.verified) {
    return { error: "Este bot no tiene WhatsApp conectado." };
  }

  try {
    await sendTextMessage({
      phoneNumberId: connection.phoneNumberId,
      accessToken: decrypt(connection.accessToken),
      to: conversation.customerPhone,
      body: parsed.data.content,
    });
  } catch (error) {
    console.error(error);
    return { error: "No se pudo enviar el mensaje por WhatsApp." };
  }

  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, role: "STAFF", content: parsed.data.content },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  revalidatePath(`/dashboard/bots/${botId}/conversations/${conversationId}`);
  return { error: null };
}
