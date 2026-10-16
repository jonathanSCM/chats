import { prisma } from "@/server/db/client";
import { emitIntegrationEvent, eventIds } from "./events";

const SETTLE_MINUTES = 10; // mismo criterio que el barrido de resúmenes del cron tick
const LOOKBACK_HOURS = 24;
const BATCH = 20;

/**
 * Emite `message.created` para un mensaje ya guardado. Pensado para llamarse sin
 * `await` desde el flujo de WhatsApp: nunca lanza y no demora la respuesta a Meta.
 */
export async function emitMessageCreated(messageId: string): Promise<void> {
  try {
    // Chequeo barato primero: la mayoría de las organizaciones no tiene webhook y no
    // vale la pena cargar contacto y oportunidades por cada mensaje.
    const probe = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        conversation: {
          select: {
            bot: {
              select: {
                organization: {
                  select: { integrationWebhooks: { where: { enabled: true }, select: { id: true }, take: 1 } },
                },
              },
            },
          },
        },
      },
    });
    if (!probe || probe.conversation.bot.organization.integrationWebhooks.length === 0) return;

    const m = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        role: true,
        content: true,
        mediaType: true,
        createdAt: true,
        conversation: {
          select: {
            assignedToId: true,
            customerPhone: true,
            customerName: true,
            bot: { select: { organizationId: true } },
            contact: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                opportunities: {
                  where: { archivedAt: null },
                  orderBy: { updatedAt: "desc" },
                  take: 1,
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    if (!m) return;

    const c = m.conversation;
    await emitIntegrationEvent({
      eventId: eventIds.message(m.id),
      type: "message.created",
      organizationId: c.bot.organizationId,
      data: {
        conversationId: m.conversationId,
        messageId: m.id,
        role: m.role,
        mediaType: m.mediaType,
        text: m.content?.trim() ? m.content : null,
        createdAt: m.createdAt.toISOString(),
        contact: {
          id: c.contact?.id ?? null,
          name: c.contact?.fullName ?? c.customerName ?? null,
          phone: c.contact?.phone ?? c.customerPhone,
        },
        opportunityId: c.contact?.opportunities[0]?.id ?? null,
        assignedToId: c.assignedToId,
      },
    });
  } catch (e) {
    console.error("[integrations] message.created falló:", e instanceof Error ? e.message : e);
  }
}

/**
 * Emite `meeting.transcript_ready` para reuniones que ya "asentaron" su transcripción.
 * El eventId lleva el hash del texto: si no cambió no se duplica; si se corrige, se reemite.
 * Solo mira reuniones tocadas en las últimas 24 h y organizaciones con webhook activo.
 */
export async function emitSettledMeetingTranscripts(now = new Date()): Promise<number> {
  const settledBefore = new Date(now.getTime() - SETTLE_MINUTES * 60_000);
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000);

  const meetings = await prisma.meeting.findMany({
    where: {
      updatedAt: { gt: since, lt: settledBefore },
      scheduledAt: { lt: settledBefore },
      OR: [{ transcript: { not: null } }, { audioTranscript: { not: null } }],
      organization: { integrationWebhooks: { some: { enabled: true } } },
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      scheduledAt: true,
      transcript: true,
      audioTranscript: true,
      notes: true,
      opportunityId: true,
    },
    orderBy: { updatedAt: "desc" },
    take: BATCH,
  });

  for (const m of meetings) {
    const text = [m.transcript, m.audioTranscript, m.notes].filter(Boolean).join("\n---\n");
    if (!text.trim()) continue;
    await emitIntegrationEvent({
      eventId: eventIds.transcriptReady(m.id, text),
      type: "meeting.transcript_ready",
      organizationId: m.organizationId,
      data: {
        meetingId: m.id,
        title: m.title?.trim() || "Reunión",
        scheduledAt: m.scheduledAt.toISOString(),
        transcript: m.transcript,
        audioTranscript: m.audioTranscript,
        notes: m.notes,
        opportunityId: m.opportunityId,
      },
    });
  }
  return meetings.length;
}

/**
 * Emite `document.received` cuando un documento (PDF, etc.) de WhatsApp ya se descargo y esta
 * disponible. El integrador lo baja luego con GET /messages/{id}/media. Nunca lanza.
 */
export async function emitDocumentReceived(messageId: string): Promise<void> {
  try {
    const m = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        mediaType: true,
        mediaStatus: true,
        fileName: true,
        mimeType: true,
        createdAt: true,
        conversation: { select: { bot: { select: { organizationId: true } } } },
      },
    });
    if (!m || m.mediaType !== "DOCUMENT" || m.mediaStatus !== "READY") return;
    await emitIntegrationEvent({
      eventId: eventIds.documentReceived(m.id),
      type: "document.received",
      organizationId: m.conversation.bot.organizationId,
      data: {
        messageId: m.id,
        conversationId: m.conversationId,
        fileName: m.fileName,
        mimeType: m.mimeType,
        receivedAt: m.createdAt.toISOString(),
      },
    });
  } catch (e) {
    console.error("[integrations] document.received falló:", e instanceof Error ? e.message : e);
  }
}

export async function emitMeetingSummaryReady(meetingId: string): Promise<void> {
  try {
    const m = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: { id: true, organizationId: true, aiSummary: true, aiSummaryData: true, aiSummaryAt: true },
    });
    if (!m?.aiSummaryAt) return;
    await emitIntegrationEvent({
      eventId: eventIds.summaryReady(m.id, m.aiSummaryAt),
      type: "meeting.summary_ready",
      organizationId: m.organizationId,
      data: {
        meetingId: m.id,
        aiSummary: m.aiSummary,
        aiSummaryData: m.aiSummaryData ?? null,
        aiSummaryAt: m.aiSummaryAt.toISOString(),
      },
    });
  } catch (e) {
    console.error("[integrations] meeting.summary_ready falló:", e instanceof Error ? e.message : e);
  }
}
