import { z } from "zod";
import { analyzeFollowUp } from "@/server/services/ai/follow-up";
import { AiBudgetExceededError, isAiGloballyEnabled } from "@/server/services/ai/client";

export const analyzeFollowUpPayload = z.object({
  opportunityId: z.string(),
});

export async function handleAnalyzeFollowUp(rawPayload: unknown): Promise<void> {
  const { opportunityId } = analyzeFollowUpPayload.parse(rawPayload);

  // Solo el interruptor general: si esta organización no tiene clave disponible, runStructured la omite por su cuenta.
  if (!isAiGloballyEnabled()) return;

  try {
    await analyzeFollowUp(opportunityId);
  } catch (error) {
    // Quedarse sin presupuesto no es un fallo del job: reintentarlo solo
    // llenaría la cola de errores hasta que cambie el día.
    if (error instanceof AiBudgetExceededError) {
      console.warn("[ai] Tope de gasto diario alcanzado; se omite el análisis.");
      return;
    }
    throw error;
  }
}
