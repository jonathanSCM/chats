import { z } from "zod";
import { generateMeetingSummary } from "@/server/services/meeting-summary";
import { AiCreditsError } from "@/server/services/ai/client";

export const meetingSummaryPayload = z.object({ meetingId: z.string() });

/**
 * Genera el resumen con IA de una reunión que ya tiene transcripción. Si la
 * IA falla o se agota el tope diario, el error sube y la cola reintenta con
 * espera creciente.
 */
export async function handleMeetingSummary(rawPayload: unknown): Promise<void> {
  const { meetingId } = meetingSummaryPayload.parse(rawPayload);
  try {
    await generateMeetingSummary(meetingId);
  } catch (error) {
    // Sin créditos o con el plan vencido no se reintenta: la reunión queda sin resumir y el barrido periódico la retoma
    // apenas haya créditos o se renueve el plan.
    if (error instanceof AiCreditsError) {
      console.warn(`[meeting-summary] ${error.message}`);
      return;
    }
    throw error;
  }
}
