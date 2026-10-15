import { createHash } from "node:crypto";
import { prisma } from "@/server/db/client";
import { enqueue } from "@/server/jobs";

export const INTEGRATION_EVENT_TYPES = [
  "message.created",
  "conversation.assigned",
  "meeting.transcript_ready",
  "meeting.summary_ready",
  "opportunity.stage_changed",
  "opportunity.next_action_changed",
  "activity.created",
  "activity.completed",
  "document.received",
] as const;
export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

export interface IntegrationEvent {
  eventId: string;
  type: string;
  organizationId: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

/** `eventId` determinísticos: el receptor deduplica por este valor. */
export const eventIds = {
  message: (messageId: string) => `msg_${messageId}`,
  transcriptReady: (meetingId: string, text: string) =>
    `mtr_${meetingId}_${createHash("sha1").update(text).digest("hex").slice(0, 12)}`,
  summaryReady: (meetingId: string, at: Date) => `msr_${meetingId}_${at.getTime()}`,
  activityCreated: (activityId: string) => `act_${activityId}`,
  activityCompleted: (activityId: string) => `actdone_${activityId}`,
  nextActionChanged: (opportunityId: string, at: Date) => `nxt_${opportunityId}_${at.getTime()}`,
  stageChanged: (opportunityId: string, at: Date) => `stg_${opportunityId}_${at.getTime()}`,
  conversationAssigned: (conversationId: string, at: Date) => `asg_${conversationId}_${at.getTime()}`,
  documentReceived: (messageId: string) => `doc_${messageId}`,
};

export function buildEvent(p: {
  eventId: string;
  type: IntegrationEventType | "ping";
  organizationId: string;
  data: Record<string, unknown>;
  occurredAt?: Date;
}): IntegrationEvent {
  return {
    eventId: p.eventId,
    type: p.type,
    organizationId: p.organizationId,
    occurredAt: (p.occurredAt ?? new Date()).toISOString(),
    data: p.data,
  };
}

/**
 * Encola un job de entrega por cada webhook habilitado y suscripto. Idempotente por
 * `uniqueKey`. NUNCA lanza ni bloquea la operación de origen: perder un aviso es malo,
 * tumbar el guardado de un mensaje por eso es peor.
 */
export async function emitIntegrationEvent(p: {
  eventId: string;
  type: IntegrationEventType;
  organizationId: string;
  data: Record<string, unknown>;
}): Promise<void> {
  try {
    const webhooks = await prisma.integrationWebhook.findMany({
      where: { organizationId: p.organizationId, enabled: true },
      select: { id: true, events: true },
    });
    const targets = webhooks.filter((w) => w.events.length === 0 || w.events.includes(p.type));
    if (targets.length === 0) return;

    const event = buildEvent(p);
    for (const w of targets) {
      await enqueue({
        type: "integration_webhook_delivery",
        payload: { webhookId: w.id, event },
        uniqueKey: `intg-${w.id}-${p.eventId}`,
        maxAttempts: 8,
      });
    }
  } catch (e) {
    console.error("[integrations] no se pudo encolar el evento", p.type, e instanceof Error ? e.message : e);
  }
}
