import { z } from "zod";
import { generateMeetingSummary } from "@/server/services/meeting-summary";

export const meetingSummaryPayload = z.object({ meetingId: z.string() });

/**
 * Genera el resumen con IA de una reunión que ya tiene transcripción. Si la
 * IA falla o se agota el tope diario, el error sube y la cola reintenta con
 * espera creciente.
 */
export async function handleMeetingSummary(rawPayload: unknown): Promise<void> {
  const { meetingId } = meetingSummaryPayload.parse(rawPayload);
  await generateMeetingSummary(meetingId);
}
