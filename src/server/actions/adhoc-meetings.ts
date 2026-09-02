"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { createMeetEvent, isGoogleMeetEnabled } from "@/server/services/google-calendar";
import { scheduleMeetingBotJoin } from "@/server/services/meeting-bot";
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
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
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
      meetingUrl = await createMeetEvent({ summary: parsed.data.title, scheduledAt, durationMinutes });
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

export async function deleteAdhocMeetingAction(meetingId: string): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { organizationId: true, opportunityId: true },
  });
  if (!meeting || meeting.organizationId !== organizationId || meeting.opportunityId !== null) {
    return { error: "Reunión no encontrada" };
  }

  await prisma.meeting.delete({ where: { id: meetingId } });

  revalidatePath(PATH);
  revalidatePath("/dashboard/calendario");
  revalidatePath("/dashboard");
  return { error: null };
}
