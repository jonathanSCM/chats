import { z } from "zod";
import { reportOpportunityQualified, reportOpportunityWon } from "@/server/services/meta-conversions";

export const metaConversionEventPayload = z.object({
  opportunityId: z.string(),
  eventName: z.enum(["QualifiedLead", "Purchase"]),
});

/**
 * Despacha el evento de Conversions API correspondiente -- encolado desde
 * crm.ts (updateOpportunityFieldAction) cuando una oportunidad deja la
 * etapa de entrada por defecto (QualifiedLead) o pasa a Ganado (Purchase).
 * Si falla (red, Meta caído, permiso faltante), se deja propagar el error:
 * la cola lo reintenta sola con backoff -- ver meta-conversions.ts sobre
 * por qué eso es seguro (event_id determinístico, Meta deduplica).
 */
export async function handleMetaConversionEvent(rawPayload: unknown): Promise<void> {
  const { opportunityId, eventName } = metaConversionEventPayload.parse(rawPayload);

  if (eventName === "QualifiedLead") {
    await reportOpportunityQualified(opportunityId);
  } else {
    await reportOpportunityWon(opportunityId);
  }
}
