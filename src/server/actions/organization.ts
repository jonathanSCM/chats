"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { signOut } from "@/server/auth";
import { getOrCreateOrgCalendar, shareCalendar, unshareCalendar, isGoogleMeetEnabled } from "@/server/services/google-calendar";
import type { ActionState } from "./types";

const renameSchema = z.object({ name: z.string().min(2, "Requerido").max(120) });

export async function renameOrganizationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede cambiar este dato" };
  }

  const parsed = renameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { name: parsed.data.name },
  });

  revalidatePath("/dashboard/organization");
  return { error: null, message: "Nombre actualizado." };
}

// Mismos límites que ai/follow-up.ts (clampMessageLimit) — se repiten acá
// nada más para poder dar un mensaje de error claro antes de guardar; el
// clamp real que protege el gasto vive en follow-up.ts, no acá.
const AI_MESSAGE_LIMIT_MIN = 5;
const AI_MESSAGE_LIMIT_MAX = 100;

const aiSettingsSchema = z.object({
  aiMessageLimit: z.coerce
    .number()
    .int()
    .min(AI_MESSAGE_LIMIT_MIN, `Mínimo ${AI_MESSAGE_LIMIT_MIN}`)
    .max(AI_MESSAGE_LIMIT_MAX, `Máximo ${AI_MESSAGE_LIMIT_MAX}`),
});

export async function updateAiSettingsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede cambiar este dato" };
  }

  const parsed = aiSettingsSchema.safeParse({
    aiMessageLimit: formData.get("aiMessageLimit"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { aiMessageLimit: parsed.data.aiMessageLimit },
  });

  revalidatePath("/dashboard/organization");
  return { error: null, message: "Configuración de IA actualizada." };
}

const shareCalendarSchema = z.object({ email: z.email("Correo inválido") });

/**
 * Comparte el calendario de Google de la organización (solo lectura) con un
 * correo — quien lo reciba ve ahí TODAS las reuniones que se agenden con
 * Google Meet desde esta organización, no solo una puntual. Crea el
 * calendario si todavía no existía (primera vez que se comparte o se agenda
 * una reunión con Meet).
 */
export async function shareOrgCalendarAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede cambiar este dato" };
  }
  if (!isGoogleMeetEnabled()) {
    return { error: "Google Meet no está configurado en el servidor." };
  }

  const parsed = shareCalendarSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: { name: true, googleCalendarShares: true },
  });
  if (org.googleCalendarShares.includes(parsed.data.email)) {
    return { error: "Ese correo ya tiene acceso." };
  }

  try {
    const calendarId = await getOrCreateOrgCalendar(session.user.organizationId, org.name);
    await shareCalendar(calendarId, parsed.data.email);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No se pudo compartir el calendario." };
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { googleCalendarShares: { push: parsed.data.email } },
  });

  revalidatePath("/dashboard/organization");
  return { error: null, message: "Calendario compartido." };
}

export async function unshareOrgCalendarAction(email: string): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede cambiar este dato" };
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: { googleCalendarId: true, googleCalendarShares: true },
  });

  if (org.googleCalendarId) {
    await unshareCalendar(org.googleCalendarId, email).catch(() => {});
  }

  await prisma.organization.update({
    where: { id: session.user.organizationId },
    data: { googleCalendarShares: org.googleCalendarShares.filter((e) => e !== email) },
  });

  revalidatePath("/dashboard/organization");
  return { error: null };
}

/**
 * Borra la organización entera: bots, conexiones de WhatsApp, contactos,
 * oportunidades, conversaciones, mensajes, base de conocimiento y todos los
 * usuarios del equipo (cascada por las relaciones del schema). Es
 * irreversible — por eso exige escribir el nombre exacto de la organización,
 * no un simple "sí/no". Los registros de auditoría quedan (no tienen relación
 * con clave foránea a propósito), como rastro de que existió y se borró.
 */
export async function deleteOrganizationAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    return { error: "Solo el dueño de la organización puede eliminarla" };
  }

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: session.user.organizationId },
    select: { id: true, name: true },
  });

  const confirmation = String(formData.get("confirmName") ?? "");
  if (confirmation !== org.name) {
    return { error: `Escribe exactamente "${org.name}" para confirmar` };
  }

  await prisma.organization.delete({ where: { id: org.id } });

  await signOut({ redirectTo: "/login" });
  return { error: null };
}
