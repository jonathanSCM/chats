"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import {
  createMeetEvent,
  updateMeetEvent,
  cancelMeetEvent,
  getOrCreateOrgCalendar,
  isGoogleMeetEnabled,
} from "@/server/services/google-calendar";
import {
  createUserMeetEvent,
  updateUserMeetEvent,
  cancelUserMeetEvent,
  hasGoogleCalendarConnected,
} from "@/server/services/google-calendar-user";
import {
  scheduleMeetingBotJoin,
  scheduleMeetingBotJoinNow,
  cancelMeetingBotJoin,
  stopMeetingBot,
  isMeetingBotEnabled,
} from "@/server/services/meeting-bot";
import { requestMeetingSummaryPdf } from "@/server/services/meeting-transcript";
import { deleteMediaFile } from "@/lib/media-storage";
import { parseGuestEmails } from "@/lib/guest-emails";
import type { ActionState } from "./types";

const PATH = "/dashboard/reuniones";

// Reuniones sueltas: cualquiera del equipo puede crear y ver — no dependen
// de una Opportunity ni de "dueño de la cartera" (ver canEditOpportunity en
// crm.ts, que acá no aplica: no hay cliente asignado a nadie).
async function requireOrg() {
  const session = await requireSession();
  if (!session.user.organizationId) throw new Error("Sin organización");
  return { organizationId: session.user.organizationId, userId: session.user.id };
}

const createAdhocMeetingSchema = z.object({
  title: z.string().min(1, "Poné un título").max(160),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600).optional(),
  meetingUrl: z.string().max(500).optional(),
  withGoogleMeet: z.coerce.boolean().optional(),
  guestEmails: z.string().max(2000).optional(),
  botEnabled: z.coerce.boolean().optional(),
});

export async function createAdhocMeetingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const parsed = createAdhocMeetingSchema.safeParse({
    title: formData.get("title"),
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

  const guestEmailsResult = parseGuestEmails(parsed.data.guestEmails);
  if ("error" in guestEmailsResult) {
    return { error: guestEmailsResult.error };
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha inválida" };
  }

  const durationMinutes = parsed.data.durationMinutes ?? 30;
  let meetingUrl = parsed.data.meetingUrl || null;
  let googleEventId: string | null = null;
  let googleCalendarOwnerId: string | null = null;
  const botEnabled = parsed.data.botEnabled ?? true;

  if (!meetingUrl && parsed.data.withGoogleMeet) {
    // Si quien crea la reunión conectó su propio Google Calendar (Mi
    // Perfil), el evento nace ahí -- así le queda en SU agenda de verdad, no
    // solo en un calendario secundario compartido que nadie mira desde su
    // Google normal. Si no lo conectó, sigue igual que siempre.
    const useOwnCalendar = await hasGoogleCalendarConnected(userId);
    try {
      if (useOwnCalendar) {
        const event = await createUserMeetEvent({
          userId,
          summary: parsed.data.title,
          scheduledAt,
          durationMinutes,
          attendeeEmails: guestEmailsResult.emails,
        });
        meetingUrl = event.meetingUrl;
        googleEventId = event.eventId;
        googleCalendarOwnerId = userId;
      } else {
        if (!isGoogleMeetEnabled()) {
          return { error: "Google Meet no está configurado en el servidor. Contactá al administrador." };
        }
        const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
        const calendarId = await getOrCreateOrgCalendar(organizationId, org.name);
        const event = await createMeetEvent({
          calendarId,
          summary: parsed.data.title,
          scheduledAt,
          durationMinutes,
          attendeeEmails: guestEmailsResult.emails,
        });
        meetingUrl = event.meetingUrl;
        googleEventId = event.eventId;
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo crear el evento en Google Calendar." };
    }
  }

  const meeting = await prisma.meeting.create({
    data: {
      organizationId,
      opportunityId: null,
      title: parsed.data.title,
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
  revalidatePath("/dashboard/calendario");
  revalidatePath("/dashboard");
  return { error: null, message: "Reunión creada." };
}

const joinNowSchema = z.object({
  meetingUrl: z.string().min(1, "Pegá el link de la reunión").max(500),
});

/**
 * "Unir el bot ya mismo": alguien ya está en una reunión en vivo y quiere
 * que el bot se sume ahora — sin fecha, sin Google Meet (el link ya existe,
 * es de una reunión que ya empezó). No se sabe cuánto va a durar, así que
 * se usa un colchón generoso (90 min) — el bot igual corta antes solo si
 * detecta que se quedó solo en la llamada.
 */
export async function joinMeetingNowAction(_prevState: ActionState, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  if (!isMeetingBotEnabled()) {
    return { error: "El bot no está configurado en el servidor. Contactá al administrador." };
  }

  const parsed = joinNowSchema.safeParse({ meetingUrl: formData.get("meetingUrl") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const meeting = await prisma.meeting.create({
    data: {
      organizationId,
      opportunityId: null,
      title: "Reunión en vivo",
      scheduledAt: new Date(),
      durationMinutes: 90,
      meetingUrl: parsed.data.meetingUrl,
      status: "CONFIRMED",
    },
  });

  await scheduleMeetingBotJoinNow(meeting.id);

  revalidatePath(PATH);
  revalidatePath("/dashboard/calendario");
  revalidatePath("/dashboard");
  return { error: null, message: "Avisado — el bot debería pedir unirse en un par de minutos." };
}

export async function stopMeetingBotAction(meetingId: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { organizationId: true } });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }

  const result = await stopMeetingBot(meetingId);
  if (!result.ok) {
    return { error: result.error ?? "No se pudo detener el bot" };
  }

  revalidatePath(PATH);
  return { error: null, message: "Avisado — el bot debería salir en breve." };
}

export async function generateMeetingSummaryPdfAction(meetingId: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { organizationId: true } });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }

  const result = await requestMeetingSummaryPdf(meetingId, organizationId);
  if (!result.ok) return { error: result.error ?? "No se pudo generar el resumen" };

  revalidatePath(PATH);
  return { error: null, message: "Resumen en PDF generado." };
}

export async function deleteAdhocMeetingAction(meetingId: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true, attachments: true, googleEventId: true, googleCalendarOwnerId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  await prisma.meeting.delete({ where: { id: meetingId } });
  await Promise.all(meeting.attachments.map((a) => deleteMediaFile(a.url)));
  await cancelMeetingBotJoin(meetingId);
  if (meeting.googleEventId) {
    if (meeting.googleCalendarOwnerId) {
      await cancelUserMeetEvent({ userId: meeting.googleCalendarOwnerId, eventId: meeting.googleEventId }).catch(() => {});
    } else {
      const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarId: true } });
      if (org?.googleCalendarId) {
        await cancelMeetEvent({ calendarId: org.googleCalendarId, eventId: meeting.googleEventId }).catch(() => {});
      }
    }
  }

  revalidatePath(PATH);
  revalidatePath("/dashboard/calendario");
  revalidatePath("/dashboard");
  return { error: null };
}

const updateAdhocMeetingSchema = z.object({
  title: z.string().max(160).optional(),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600),
  meetingUrl: z.string().max(500).optional(),
  botEnabled: z.coerce.boolean().optional(),
});

/**
 * Cambiar nombre, link, fecha/hora, duración o si el bot se une. El nombre y
 * el link son solo de nuestra base -- a propósito no se tocan en el evento
 * real de Calendar (si lo hay), que sigue siendo el que se creó al agendar.
 */
export async function updateAdhocMeetingAction(meetingId: string, formData: FormData): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true, title: true, meetingUrl: true, googleEventId: true, googleCalendarOwnerId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  const parsed = updateAdhocMeetingSchema.safeParse({
    title: formData.get("title") || undefined,
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes"),
    meetingUrl: formData.get("meetingUrl") || undefined,
    botEnabled: formData.has("botEnabled") ? formData.get("botEnabled") : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha inválida" };
  }
  const botEnabled = parsed.data.botEnabled ?? false;
  const meetingUrl = parsed.data.meetingUrl?.trim() || null;

  if (meeting.googleEventId) {
    try {
      if (meeting.googleCalendarOwnerId) {
        await updateUserMeetEvent({
          userId: meeting.googleCalendarOwnerId,
          eventId: meeting.googleEventId,
          scheduledAt,
          durationMinutes: parsed.data.durationMinutes,
        });
      } else {
        const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarId: true } });
        if (org?.googleCalendarId) {
          await updateMeetEvent({
            calendarId: org.googleCalendarId,
            eventId: meeting.googleEventId,
            scheduledAt,
            durationMinutes: parsed.data.durationMinutes,
          });
        }
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : "No se pudo actualizar el evento en Google Calendar." };
    }
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      title: parsed.data.title?.trim() || meeting.title,
      scheduledAt,
      durationMinutes: parsed.data.durationMinutes,
      meetingUrl,
      botEnabled,
    },
  });

  if (meetingUrl && botEnabled) {
    await scheduleMeetingBotJoin(meetingId, scheduledAt);
  } else {
    await cancelMeetingBotJoin(meetingId);
  }

  revalidatePath(PATH);
  revalidatePath("/dashboard/calendario");
  return { error: null, message: "Reunión actualizada." };
}

/**
 * Solo el nombre -- a diferencia de updateAdhocMeetingAction (que además
 * pide fecha/duración) esto se usa para el renombrado rápido en la lista, sin
 * abrir el formulario completo, y sin la restricción de "no se puede editar
 * si ya está cancelada/realizada" (renombrar para identificarla después,
 * ej. "Reunión Extensión" -> "Reunión con Juanito", tiene sentido en
 * cualquier estado).
 */
export async function renameAdhocMeetingAction(meetingId: string, title: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const trimmed = title.trim();
  if (!trimmed) return { error: "Poné un nombre" };
  if (trimmed.length > 160) return { error: "Nombre muy largo" };

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { title: trimmed } });
  revalidatePath(PATH);
  return { error: null };
}

/** Cancela la reunión (no la borra) — si tiene evento de Calendar, lo cancela y avisa a los invitados. */
export async function cancelAdhocMeetingAction(meetingId: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true, googleEventId: true, googleCalendarOwnerId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  if (meeting.googleEventId) {
    if (meeting.googleCalendarOwnerId) {
      await cancelUserMeetEvent({ userId: meeting.googleCalendarOwnerId, eventId: meeting.googleEventId }).catch(() => {});
    } else {
      const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { googleCalendarId: true } });
      if (org?.googleCalendarId) {
        await cancelMeetEvent({ calendarId: org.googleCalendarId, eventId: meeting.googleEventId }).catch(() => {});
      }
    }
  }

  await cancelMeetingBotJoin(meetingId);
  await prisma.meeting.update({ where: { id: meetingId }, data: { status: "CANCELED" } });

  revalidatePath(PATH);
  revalidatePath("/dashboard/calendario");
  return { error: null, message: "Reunión cancelada." };
}

export interface ClientSearchResult {
  id: string;
  title: string;
  contactName: string;
}

/**
 * Buscador para "Vincular a un cliente" en el panel de una reunión suelta --
 * mismo criterio que la búsqueda equivalente de la extensión
 * (api/extension/opportunities/search), pero por sesión en vez de por
 * meetExtensionToken porque esto lo llama la propia UI del CRM.
 */
export async function searchClientsForMeetingAction(query: string): Promise<ClientSearchResult[]> {
  const { organizationId } = await requireOrg();
  const q = query.trim();
  if (q.length < 2) return [];

  const opportunities = await prisma.opportunity.findMany({
    where: {
      organizationId,
      archivedAt: null,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { contact: { fullName: { contains: q, mode: "insensitive" } } },
        { contact: { phone: { contains: q } } },
      ],
    },
    select: { id: true, title: true, contact: { select: { fullName: true, phone: true } } },
    orderBy: { updatedAt: "desc" },
    take: 8,
  });

  return opportunities.map((o) => ({
    id: o.id,
    title: o.title,
    contactName: o.contact.fullName || o.contact.phone,
  }));
}

/** Vincula la reunión a un cliente ya existente -- deja de listarse como "suelta" y pasa a verse en la ficha de ese cliente. */
export async function linkMeetingToOpportunityAction(meetingId: string, opportunityId: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId }, select: { organizationId: true } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }

  await prisma.meeting.update({ where: { id: meetingId }, data: { opportunityId } });
  revalidatePath(PATH);
  revalidatePath("/dashboard/seguimiento");
  return { error: null, message: "Reunión vinculada." };
}

const createClientAndLinkSchema = z.object({
  contactName: z.string().max(200).optional(),
  contactPhone: z.string().min(1, "Poné el teléfono").max(50),
  opportunityTitle: z.string().max(200).optional(),
});

/** Crea un cliente nuevo (Contact + Opportunity) y vincula la reunión de una -- mismo patrón que usa el popup de la extensión al cortar una reunión. */
export async function createClientAndLinkMeetingAction(
  meetingId: string,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  const parsed = createClientAndLinkSchema.safeParse({
    contactName: formData.get("contactName") || undefined,
    contactPhone: formData.get("contactPhone"),
    opportunityTitle: formData.get("opportunityTitle") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const phone = parsed.data.contactPhone.trim();
  const contact = await prisma.contact.upsert({
    where: { organizationId_phone: { organizationId, phone } },
    create: { organizationId, phone, fullName: parsed.data.contactName?.trim() || null, source: "Reunión" },
    update: {},
  });

  const opportunity = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId: contact.id,
      title: parsed.data.opportunityTitle?.trim() || parsed.data.contactName?.trim() || "Cliente nuevo",
      assignedToId: userId,
    },
  });

  await prisma.meeting.update({ where: { id: meetingId }, data: { opportunityId: opportunity.id } });

  revalidatePath(PATH);
  revalidatePath("/dashboard/seguimiento");
  return { error: null, message: "Cliente creado y reunión vinculada." };
}
