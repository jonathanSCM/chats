"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { createMeetEvent, isGoogleMeetEnabled } from "@/server/services/google-calendar";
import {
  scheduleMeetingBotJoin,
  scheduleMeetingBotJoinNow,
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
  return { organizationId: session.user.organizationId };
}

const createAdhocMeetingSchema = z.object({
  title: z.string().min(1, "Poné un título").max(160),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600).optional(),
  meetingUrl: z.string().max(500).optional(),
  withGoogleMeet: z.coerce.boolean().optional(),
  guestEmails: z.string().max(2000).optional(),
});

export async function createAdhocMeetingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const parsed = createAdhocMeetingSchema.safeParse({
    title: formData.get("title"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes") || undefined,
    meetingUrl: formData.get("meetingUrl") || undefined,
    withGoogleMeet: formData.get("withGoogleMeet") || undefined,
    guestEmails: formData.get("guestEmails") || undefined,
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

  if (!meetingUrl && parsed.data.withGoogleMeet) {
    if (!isGoogleMeetEnabled()) {
      return { error: "Google Meet no está configurado en el servidor. Contactá al administrador." };
    }
    try {
      meetingUrl = await createMeetEvent({
        summary: parsed.data.title,
        scheduledAt,
        durationMinutes,
        attendeeEmails: guestEmailsResult.emails,
      });
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
      guestEmails: guestEmailsResult.emails,
      status: "SCHEDULED",
    },
  });

  if (meetingUrl) {
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
    select: { organizationId: true, opportunityId: true, attachments: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  await prisma.meeting.delete({ where: { id: meetingId } });
  await Promise.all(meeting.attachments.map((a) => deleteMediaFile(a.url)));

  revalidatePath(PATH);
  revalidatePath("/dashboard/calendario");
  revalidatePath("/dashboard");
  return { error: null };
}
