import { randomUUID } from "node:crypto";
import { google, type calendar_v3 } from "googleapis";
import { prisma } from "@/server/db/client";

/**
 * Una sola cuenta de Google (GOOGLE_BOT_REFRESH_TOKEN), compartida por toda
 * la plataforma, crea los eventos — por eso queda como organizadora de la
 * reunión y Meet nunca le pide "admitir" a nadie cuando esa misma cuenta se
 * une después como bot de grabación.
 */
function isConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_BOT_REFRESH_TOKEN,
  );
}

export function isGoogleMeetEnabled(): boolean {
  return isConfigured();
}

function getOAuthClient() {
  if (!isConfigured()) {
    throw new Error(
      "Google Meet no está configurado en el servidor (faltan GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_BOT_REFRESH_TOKEN).",
    );
  }
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: process.env.GOOGLE_BOT_REFRESH_TOKEN });
  return client;
}

function getCalendarClient(): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: getOAuthClient() });
}

/**
 * Todas las organizaciones de la plataforma comparten la misma cuenta de
 * Google — si las reuniones se crearan todas en su calendario "primary",
 * compartir ese calendario con alguien le mostraría las reuniones de
 * TODOS los clientes de la plataforma, no solo las de su organización. Por
 * eso cada organización tiene su propio calendario secundario, creado
 * recién la primera vez que hace falta (al crear la primera reunión con
 * Google Meet, o al compartirlo a mano desde /dashboard/organization).
 */
export async function getOrCreateOrgCalendar(organizationId: string, organizationName: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { googleCalendarId: true },
  });
  if (org.googleCalendarId) return org.googleCalendarId;

  const calendar = getCalendarClient();
  const res = await calendar.calendars.insert({
    requestBody: { summary: `${organizationName} — Reuniones` },
  });
  const calendarId = res.data.id;
  if (!calendarId) throw new Error("Google Calendar no devolvió un id para el calendario creado.");

  await prisma.organization.update({ where: { id: organizationId }, data: { googleCalendarId: calendarId } });
  return calendarId;
}

/** Comparte (solo lectura) el calendario de la organización con un correo. */
export async function shareCalendar(calendarId: string, email: string): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.acl.insert({
    calendarId,
    requestBody: { role: "reader", scope: { type: "user", value: email } },
  });
}

/** Deja de compartir el calendario con ese correo. */
export async function unshareCalendar(calendarId: string, email: string): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.acl.delete({ calendarId, ruleId: `user:${email}` }).catch((error) => {
    // Ya no estaba compartido con ese correo (p. ej. se sacó dos veces
    // seguidas) — no es un error real, el estado final es el que se quería.
    if (error?.code !== 404) throw error;
  });
}

export interface CreatedMeetEvent {
  meetingUrl: string;
  eventId: string;
}

export async function createMeetEvent({
  calendarId,
  summary,
  scheduledAt,
  durationMinutes,
  attendeeEmails,
}: {
  calendarId: string;
  summary: string;
  scheduledAt: Date;
  durationMinutes: number;
  /** Si se pasa, Calendar les manda a estos correos la invitación real (aceptar/rechazar, recordatorio). */
  attendeeEmails?: string[];
}): Promise<CreatedMeetEvent> {
  const calendar = getCalendarClient();
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  const res = await calendar.events.insert({
    calendarId,
    conferenceDataVersion: 1,
    // Sin esto, la API crea el evento pero no manda ningún correo a los
    // invitados — quedarían agregados "en silencio".
    sendUpdates: attendeeEmails?.length ? "all" : "none",
    requestBody: {
      summary,
      start: { dateTime: scheduledAt.toISOString() },
      end: { dateTime: endAt.toISOString() },
      conferenceData: {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
      attendees: attendeeEmails?.map((email) => ({ email })),
    },
  });

  const meetingUrl = res.data.hangoutLink;
  const eventId = res.data.id;
  if (!meetingUrl || !eventId) throw new Error("Google Calendar no devolvió el evento creado.");
  return { meetingUrl, eventId };
}

/** Cambia la hora/duración de un evento ya creado — avisa a los invitados del cambio. */
export async function updateMeetEvent({
  calendarId,
  eventId,
  scheduledAt,
  durationMinutes,
}: {
  calendarId: string;
  eventId: string;
  scheduledAt: Date;
  durationMinutes: number;
}): Promise<void> {
  const calendar = getCalendarClient();
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: "all",
    requestBody: {
      start: { dateTime: scheduledAt.toISOString() },
      end: { dateTime: endAt.toISOString() },
    },
  });
}

/** Cancela el evento real — avisa a los invitados de la cancelación. */
export async function cancelMeetEvent({ calendarId, eventId }: { calendarId: string; eventId: string }): Promise<void> {
  const calendar = getCalendarClient();
  await calendar.events.delete({ calendarId, eventId, sendUpdates: "all" }).catch((error) => {
    // Ya no existía (p. ej. se canceló dos veces) — el estado final es el
    // que se quería igual.
    if (error?.code !== 404 && error?.code !== 410) throw error;
  });
}
