import { z } from "zod";
import { runQualificationTurn } from "@/server/services/ai/qualification-bot";
import { AiBudgetExceededError, isAiEnabled } from "@/server/services/ai/client";

export const botReplyPayload = z.object({
  conversationId: z.string(),
});

export async function handleBotReply(rawPayload: unknown): Promise<void> {
  const { conversationId } = botReplyPayload.parse(rawPayload);

  if (!isAiEnabled()) return;

  try {
    await runQualificationTurn(conversationId);
  } catch (error) {
    // Igual que analyze-follow-up: quedarse sin presupuesto no es un fallo
    // del job, solo llenaría la cola de reintentos hasta que cambie el día.
    if (error instanceof AiBudgetExceededError) {
      console.warn("[bot] Tope de gasto diario alcanzado; se omite la respuesta del bot.");
      return;
    }
    throw error;
  }
}
