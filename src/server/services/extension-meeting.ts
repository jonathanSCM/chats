import { prisma } from "@/server/db/client";
import { extractMeetCode, normalizeMeetUrl } from "@/lib/meet-code";

/** La cuenta interna con la que el parche del asistente (Vexa) habla con el CRM: sirve a todas las organizaciones. */
const PLATFORM_BOT_EMAIL_SUFFIX = "@internal.proshop.lat";

export function isPlatformBotEmail(email: string): boolean {
  return email.endsWith(PLATFORM_BOT_EMAIL_SUFFIX);
}

/**
 * Organización a la que pertenece lo que manda este token para esta reunión. Una persona (extensión de Chrome) trabaja
 * en SU organización. El asistente es uno solo para todas: su token es de una cuenta interna de ProShop, así que la
 * organización sale de la reunión a la que pertenece ese asistente: primero por el id de su sesión de Vexa (cada
 * reunión del CRM lo guarda al pedir el asistente: es exacto, aunque el mismo link de Meet lo usen dos organizaciones) y,
 * si el asistente no lo mandó, por el link. Sin esto, subtítulos, comandos y cobros de otras organizaciones iban a ProShop.
 */
export async function resolveExtensionOrganizationId(
  user: { organizationId: string; email: string },
  meetingUrl: string,
  vexaSessionId?: number | null,
): Promise<string> {
  if (!isPlatformBotEmail(user.email)) return user.organizationId;
  if (vexaSessionId) {
    const bySession = await prisma.meeting.findFirst({
      where: { vexaSessionId },
      orderBy: { createdAt: "desc" },
      select: { organizationId: true },
    });
    if (bySession) return bySession.organizationId;
  }
  const code = extractMeetCode(meetingUrl);
  if (!code) return user.organizationId;
  const meeting = await prisma.meeting.findFirst({
    where: { meetingUrl: { contains: code, mode: "insensitive" }, botStatus: { not: null }, status: { not: "CANCELED" } },
    orderBy: { createdAt: "desc" },
    select: { organizationId: true },
  });
  return meeting?.organizationId ?? user.organizationId;
}

/** Nombres que el CRM pone solo cuando nadie le dio uno: son los únicos que un nombre nuevo puede reemplazar. */
const PLACEHOLDER_TITLES = ["Reunión Extensión", "Reunión en vivo"];

/** El nombre que la persona escribió en el panel de la extensión: sin espacios de más, máximo 160 caracteres; vacío = ninguno. */
export function cleanMeetingTitle(raw: string | null | undefined): string | null {
  const title = raw?.replace(/\s+/g, " ").trim().slice(0, 160);
  return title ? title : null;
}

export type ExtensionOrgResult = { ok: true; organizationId: string } | { ok: false; error: string };

/**
 * Las organizaciones a las que pertenece una persona (las del selector de organización del CRM) y cuál tiene activa.
 * La activa siempre aparece, aunque le falte la fila de membresía.
 */
export async function listUserOrganizations(user: { id: string; organizationId: string }) {
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: user.id },
    select: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const orgs = memberships.map((m) => m.organization);
  if (!orgs.some((o) => o.id === user.organizationId)) {
    const active = await prisma.organization.findUnique({ where: { id: user.organizationId }, select: { id: true, name: true } });
    if (active) orgs.unshift(active);
  }
  return { organizations: orgs, activeOrganizationId: user.organizationId };
}

/**
 * Decide a qué organización va lo que manda la extensión (o el userscript) de una persona:
 *  1. La que ELIGIÓ en el panel (`requestedOrganizationId`), si de verdad pertenece a ella. Es la única forma segura de
 *     llamar al asistente para una reunión que no está agendada en ninguna parte.
 *  2. Si no eligió ninguna: la organización donde esa reunión ya está agendada (primero la activa, luego otra de las suyas).
 *  3. Si no está agendada en ninguna: la organización activa del CRM.
 * Para la cuenta interna del asistente (Vexa) ver resolveExtensionOrganizationId.
 */
export async function resolveExtensionOrg(params: {
  user: { id: string; organizationId: string; email: string };
  meetingUrl: string;
  vexaSessionId?: number | null;
  requestedOrganizationId?: string | null;
}): Promise<ExtensionOrgResult> {
  const { user, meetingUrl, vexaSessionId, requestedOrganizationId } = params;

  if (isPlatformBotEmail(user.email)) {
    return { ok: true, organizationId: await resolveExtensionOrganizationId(user, meetingUrl, vexaSessionId) };
  }

  if (requestedOrganizationId) {
    if (requestedOrganizationId === user.organizationId) return { ok: true, organizationId: requestedOrganizationId };
    const membership = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: user.id, organizationId: requestedOrganizationId } },
      select: { id: true },
    });
    if (!membership) return { ok: false, error: "No perteneces a esa organización." };
    return { ok: true, organizationId: requestedOrganizationId };
  }

  const code = extractMeetCode(meetingUrl);
  if (!code) return { ok: true, organizationId: user.organizationId };
  const where = { meetingUrl: { contains: code, mode: "insensitive" as const }, status: { not: "CANCELED" as const } };

  const inActive = await prisma.meeting.findFirst({ where: { ...where, organizationId: user.organizationId }, select: { id: true } });
  if (inActive) return { ok: true, organizationId: user.organizationId };

  const memberships = await prisma.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true } });
  if (memberships.length === 0) return { ok: true, organizationId: user.organizationId };
  const elsewhere = await prisma.meeting.findFirst({
    where: { ...where, organizationId: { in: memberships.map((m) => m.organizationId) } },
    orderBy: { createdAt: "desc" },
    select: { organizationId: true },
  });
  return { ok: true, organizationId: elsewhere?.organizationId ?? user.organizationId };
}

/**
 * Encuentra o crea la reunión que le corresponde a un link de Meet que
 * mandó la extensión de subtítulos (texto o audio) -- compartido entre
 * api/extension/transcript y api/extension/audio para no duplicar el mismo
 * criterio dos veces. Si el link ya estaba agendado en el sistema, se usa
 * esa reunión (la más reciente con ese link, por si una sala se reutiliza
 * con el tiempo); si no, se crea una nueva "Reunión Extensión" -- mismo
 * patrón que "Unir el bot ya mismo" con reuniones en vivo sin agendar.
 */
export async function resolveExtensionMeeting(params: {
  organizationId: string;
  meetingUrl: string;
  // Quién la está grabando (resuelto del token personal de la extensión) --
  // null si por alguna razón no se pudo identificar.
  recordedById?: string | null;
  // Id de la sesión del asistente en Vexa: identifica la reunión exacta (ver resolveExtensionOrganizationId).
  vexaSessionId?: number | null;
  // Nombre que la persona le puso a la reunión en el panel de la extensión. Si la reunión se crea acá, se guarda con ese
  // nombre; si ya existía con un nombre automático ("Reunión Extensión", "Reunión en vivo") se lo cambia. Una reunión ya
  // agendada o renombrada conserva el suyo.
  title?: string | null;
}): Promise<{ id: string; transcript: string | null; audioTranscript: string | null }> {
  const { organizationId, recordedById = null, vexaSessionId = null } = params;
  const title = cleanMeetingTitle(params.title);

  if (vexaSessionId) {
    const bySession = await prisma.meeting.findFirst({
      where: { organizationId, vexaSessionId, status: { not: "CANCELED" } },
      orderBy: { createdAt: "desc" },
      select: { id: true, transcript: true, audioTranscript: true },
    });
    if (bySession) return bySession;
  }

  // El mismo link llega escrito de varias formas (meet.google.com/abc-defg-hij, /meet/abc-defg-hij, con parámetros):
  // se busca por el código de la sala y las reuniones nuevas se guardan con el link canónico.
  const code = extractMeetCode(params.meetingUrl);
  const meetingUrl = normalizeMeetUrl(params.meetingUrl) ?? params.meetingUrl;

  const existing = await prisma.meeting.findFirst({
    where: {
      organizationId,
      meetingUrl: code ? { contains: code, mode: "insensitive" } : meetingUrl,
      status: { not: "CANCELED" },
    },
    orderBy: { scheduledAt: "desc" },
    select: { id: true, title: true, transcript: true, audioTranscript: true, recordedById: true },
  });
  if (existing) {
    if (title && existing.title !== title && PLACEHOLDER_TITLES.includes(existing.title ?? "")) {
      await prisma.meeting.update({ where: { id: existing.id }, data: { title } });
    }
    // No se pisa si ya había alguien -- se completa solo si todavía no se
    // sabía quién la estaba grabando.
    if (!existing.recordedById && recordedById) {
      await prisma.meeting.update({ where: { id: existing.id }, data: { recordedById } });
    }
    return existing;
  }

  return prisma.meeting.create({
    data: {
      organizationId,
      opportunityId: null,
      title: title ?? "Reunión Extensión",
      scheduledAt: new Date(),
      durationMinutes: 30,
      meetingUrl,
      status: "DONE",
      botEnabled: false,
      recordedById,
    },
    select: { id: true, transcript: true, audioTranscript: true },
  });
}
