"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import { OPEN_STAGES } from "@/lib/pipeline";
import { parseGuestEmails } from "@/lib/guest-emails";
import { createMeetEvent, getOrCreateOrgCalendar, isGoogleMeetEnabled } from "@/server/services/google-calendar";
import { createUserMeetEvent, hasGoogleCalendarConnected } from "@/server/services/google-calendar-user";
import { scheduleMeetingBotJoin } from "@/server/services/meeting-bot";
import type { ActionState } from "./types";

const PATH = "/dashboard/inbox";

const createMeetingFromConversationSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().max(160).optional(),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600).optional(),
  meetingUrl: z.string().max(500).optional(),
  withGoogleMeet: z.coerce.boolean().optional(),
  guestEmails: z.string().max(2000).optional(),
  botEnabled: z.coerce.boolean().optional(),
});

/**
 * Crea una reunión directo desde el panel del chat, sin tener que primero
 * "agregar a seguimiento" a mano -- si el contacto todavía no tiene una
 * oportunidad abierta, se crea una (mismo criterio que ensureOpportunity en
 * qualification-bot.ts) para que la reunión tenga dónde colgarse, ya que el
 * modelo Meeting solo se relaciona con un contacto a través de Opportunity.
 */
export async function createMeetingFromConversationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createMeetingFromConversationSchema.safeParse({
    conversationId: formData.get("conversationId"),
    title: formData.get("title") || undefined,
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes") || undefined,
    meetingUrl: formData.get("meetingUrl") || undefined,
    withGoogleMeet: formData.get("withGoogleMeet") || undefined,
    guestEmails: formData.get("guestEmails") || undefined,
    botEnabled: formData.has("botEnabled") ? "true" : "false",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: {
      botId: true,
      contact: { select: { id: true, fullName: true, phone: true } },
    },
  });
  if (!conversation) return { error: "Conversación no encontrada" };
  if (!conversation.contact) return { error: "Esta conversación no tiene un contacto asociado" };

  const { session, bot } = await requireBotAccess(conversation.botId);
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  const contact = conversation.contact;

  const guestEmailsResult = parseGuestEmails(parsed.data.guestEmails);
  if ("error" in guestEmailsResult) {
    return { error: guestEmailsResult.error };
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha inválida" };
  }

  // Misma búsqueda que ensureOpportunity (qualification-bot.ts): entre TODAS
  // las oportunidades del contacto, no solo la primera que devuelva Prisma
  // (ese era justo el bug que causaba leads duplicados).
  let opportunity = await prisma.opportunity.findFirst({
    where: { contactId: contact.id, archivedAt: null, stage: { in: OPEN_STAGES } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (!opportunity) {
    opportunity = await prisma.opportunity.create({
      data: {
        organizationId: bot.organizationId,
        contactId: contact.id,
        title: contact.fullName || contact.phone || "Nuevo lead",
        assignedToId: isAdmin ? null : session.user.id,
      },
      select: { id: true },
    });
  }

  const durationMinutes = parsed.data.durationMinutes ?? 30;
  let meetingUrl = parsed.data.meetingUrl?.trim() || null;
  let googleEventId: string | null = null;
  let googleCalendarOwnerId: string | null = null;
  const botEnabled = parsed.data.botEnabled ?? true;
  const title = parsed.data.title?.trim() || `Reunión con ${contact.fullName || contact.phone}`;

  // Mismo criterio que crm.ts/adhoc-meetings.ts: si quien crea la reunión
  // conectó su Google Calendar personal, se refleja ahí sin importar si
  // pegó un link propio, generó uno nuevo, o ninguna de las dos.
  const useOwnCalendar = await hasGoogleCalendarConnected(session.user.id);
  if (useOwnCalendar) {
    try {
      const event = await createUserMeetEvent({
        userId: session.user.id,
        summary: title,
        scheduledAt,
        durationMinutes,
        attendeeEmails: guestEmailsResult.emails,
        existingMeetingUrl: meetingUrl,
        generateMeetLink: Boolean(parsed.data.withGoogleMeet) && !meetingUrl,
      });
      if (event.meetingUrl) meetingUrl = event.meetingUrl;
      googleEventId = event.eventId;
      googleCalendarOwnerId = session.user.id;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo crear el evento en Google Calendar." };
    }
  } else if (!meetingUrl && parsed.data.withGoogleMeet) {
    if (!isGoogleMeetEnabled()) {
      return { error: "Google Meet no está configurado en el servidor. Contactá al administrador." };
    }
    try {
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: bot.organizationId },
        select: { name: true },
      });
      const calendarId = await getOrCreateOrgCalendar(bot.organizationId, org.name);
      const event = await createMeetEvent({
        calendarId,
        summary: title,
        scheduledAt,
        durationMinutes,
        attendeeEmails: guestEmailsResult.emails,
      });
      meetingUrl = event.meetingUrl;
      googleEventId = event.eventId;
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo crear el evento en Google Calendar." };
    }
  }

  const meeting = await prisma.meeting.create({
    data: {
      organizationId: bot.organizationId,
      opportunityId: opportunity.id,
      title,
      scheduledAt,
      durationMinutes,
      meetingUrl,
      googleEventId,
      googleCalendarOwnerId,
      guestEmails: guestEmailsResult.emails,
      botEnabled,
      status: "SCHEDULED",
    },
  });

  if (meetingUrl && botEnabled) {
    await scheduleMeetingBotJoin(meeting.id, scheduledAt);
  }

  revalidatePath(PATH);
  revalidatePath("/dashboard/seguimiento");
  return { error: null, message: "Reunión creada." };
}
