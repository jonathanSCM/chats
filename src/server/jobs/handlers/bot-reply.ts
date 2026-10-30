import { z } from "zod";
import { escalateAiUnavailable, runQualificationTurn } from "@/server/services/ai/qualification-bot";
import { AiBudgetExceededError, AiCreditsError, isAiGloballyEnabled } from "@/server/services/ai/client";

export const botReplyPayload = z.object({
  conversationId: z.string(),
});

export async function handleBotReply(rawPayload: unknown): Promise<void> {
  const { conversationId } = botReplyPayload.parse(rawPayload);

  // Solo el interruptor general: si esta organización no tiene clave disponible, runStructured la omite por su cuenta.
  if (!isAiGloballyEnabled()) return;

  try {
    await runQualificationTurn(conversationId);
  } catch (error) {
    // Igual que analyze-follow-up: quedarse sin presupuesto no es un fallo
    // del job, solo llenaría la cola de reintentos hasta que cambie el día.
    // Sin créditos o con el plan vencido: la conversación pasa a una persona (no queda sin respuesta en silencio).
    if (error instanceof AiCreditsError) {
      console.warn(`[bot] ${error.message}`);
      await escalateAiUnavailable(conversationId, "sin créditos de IA o plan vencido").catch((e) => console.error("[bot] No se pudo pasar la conversación a una persona:", e));
      return;
    }
    if (error instanceof AiBudgetExceededError) {
      console.warn("[bot] Tope de gasto diario alcanzado; se omite la respuesta del bot.");
      return;
    }
    throw error;
  }
}
