import { randomUUID, randomBytes } from "node:crypto";
import { google, type calendar_v3 } from "googleapis";
import { prisma } from "@/server/db/client";

/**
 * Calendario de Google *personal* de cada usuario (a diferencia de
 * `google-calendar.ts`, que usa una sola cuenta compartida por toda la
 * plataforma). Cuando un usuario conecta el suyo desde "Mi Perfil", sus
 * reuniones se crean/editan directo en su calendario "primary" — con
 * sincronización en las dos direcciones vía `calendar.events.watch`.
 */

/**
 * Cliente OAuth SEPARADO del que usa el bot compartido (google-calendar.ts,
 * GOOGLE_CLIENT_ID/SECRET) -- ese es de tipo "Escritorio" (flujo por
 * localhost, ver scripts/get-google-refresh-token.ts) y Google no deja
 * agregarle una URI de redirección web de verdad. Este es de tipo
 * "Aplicación web", con /api/oauth/google-calendar/callback autorizado.
 */
function requireGoogleClientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Calendar (por usuario) no está configurado en el servidor (faltan GOOGLE_CALENDAR_CLIENT_ID/GOOGLE_CALENDAR_CLIENT_SECRET).",
    );
  }
  return { clientId, clientSecret };
}

function redirectUri(): string {
  const appUrl = process.env.NEXTAUTH_URL;
  if (!appUrl) throw new Error("NEXTAUTH_URL no está configurada.");
  return `${appUrl}/api/oauth/google-calendar/callback`;
}

const SCOPES = ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email"];

export function isGoogleCalendarOAuthEnabled(): boolean {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET && process.env.NEXTAUTH_URL,
  );
}

/**
 * `state` lleva el userId firmado implícitamente por venir de una sesión ya
 * autenticada en `/api/oauth/google-calendar/connect` -- no hace falta un
 * JWT propio, ese endpoint ya exige sesión antes de generar esta URL.
 */
export function buildGoogleCalendarAuthUrl(userId: string): string {
  const { clientId, clientSecret } = requireGoogleClientCreds();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri());
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // fuerza a que SIEMPRE devuelva refresh_token, no solo la primera vez
    scope: SCOPES,
    state: userId,
  });
}

export async function exchangeGoogleCalendarCode(code: string, userId: string): Promise<void> {
  const { clientId, clientSecret } = requireGoogleClientCreds();
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri());
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token || !tokens.access_token || !tokens.expiry_date) {
    throw new Error(
      "Google no devolvió un refresh_token -- si ya habías conectado esta cuenta antes, desconectala primero y volvé a intentar.",
    );
  }
  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data } = await oauth2.userinfo.get();
  if (!data.email) throw new Error("Google no devolvió el email de la cuenta conectada.");

  await prisma.googleCalendarAccount.upsert({
    where: { userId },
    create: {
      userId,
      googleEmail: data.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expiry_date),
    },
    update: {
      googleEmail: data.email,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(tokens.expiry_date),
    },
  });

  await startWatch(userId).catch((error) => {
    // La conexión en sí ya quedó guardada y sirve para el sentido CRM→Google
    // aunque esto falle -- no se corta todo el flujo por esto.
    console.warn(`[google-calendar-user] No se pudo suscribir a notificaciones para ${userId}:`, error);
  });
}

async function getClientForAccount(account: {
  refreshToken: string;
  accessToken: string;
  tokenExpiresAt: Date;
  userId: string;
}) {
  const { clientId, clientSecret } = requireGoogleClientCreds();
  const client = new google.auth.OAuth2(clientId, clientSecret);
  client.setCredentials({
    refresh_token: account.refreshToken,
    access_token: account.accessToken,
    expiry_date: account.tokenExpiresAt.getTime(),
  });
  // Persiste el access_token renovado -- sin esto, cada llamada volvería a
  // pedir uno nuevo con el refresh_token en vez de reusar el vigente.
  client.on("tokens", (tokens) => {
    if (!tokens.access_token || !tokens.expiry_date) return;
    void prisma.googleCalendarAccount
      .update({
        where: { userId: account.userId },
        data: { accessToken: tokens.access_token, tokenExpiresAt: new Date(tokens.expiry_date) },
      })
      .catch(() => {});
  });
  return client;
}

async function getCalendarClientForUser(userId: string): Promise<{ calendar: calendar_v3.Calendar; accountId: string } | null> {
  const account = await prisma.googleCalendarAccount.findUnique({ where: { userId } });
  if (!account) return null;
  const client = await getClientForAccount(account);
  return { calendar: google.calendar({ version: "v3", auth: client }), accountId: account.id };
}

export async function hasGoogleCalendarConnected(userId: string): Promise<boolean> {
  const account = await prisma.googleCalendarAccount.findUnique({ where: { userId }, select: { id: true } });
  return Boolean(account);
}

export interface CreatedUserMeetEvent {
  meetingUrl: string;
  eventId: string;
}

export async function createUserMeetEvent({
  userId,
  summary,
  scheduledAt,
  durationMinutes,
  attendeeEmails,
}: {
  userId: string;
  summary: string;
  scheduledAt: Date;
  durationMinutes: number;
  attendeeEmails?: string[];
}): Promise<CreatedUserMeetEvent> {
  const client = await getCalendarClientForUser(userId);
  if (!client) throw new Error("Este usuario no tiene Google Calendar conectado.");
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  const res = await client.calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
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

export async function updateUserMeetEvent({
  userId,
  eventId,
  scheduledAt,
  durationMinutes,
}: {
  userId: string;
  eventId: string;
  scheduledAt: Date;
  durationMinutes: number;
}): Promise<void> {
  const client = await getCalendarClientForUser(userId);
  if (!client) return;
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  await client.calendar.events.patch({
    calendarId: "primary",
    eventId,
    sendUpdates: "all",
    requestBody: { start: { dateTime: scheduledAt.toISOString() }, end: { dateTime: endAt.toISOString() } },
  });
}

export async function cancelUserMeetEvent({ userId, eventId }: { userId: string; eventId: string }): Promise<void> {
  const client = await getCalendarClientForUser(userId);
  if (!client) return;
  await client.calendar.events.delete({ calendarId: "primary", eventId, sendUpdates: "all" }).catch((error) => {
    if (error?.code !== 404 && error?.code !== 410) throw error;
  });
}

/**
 * Suscribe a notificaciones push de Calendar (habilita el sentido
 * Google→CRM). El canal vence solo (Google lo corta después de un tiempo),
 * por eso `watchExpiresAt` se revisa periódicamente para renovarlo -- ver
 * `renewExpiringGoogleCalendarWatches`.
 */
export async function startWatch(userId: string): Promise<void> {
  const client = await getCalendarClientForUser(userId);
  if (!client) return;
  const appUrl = process.env.NEXTAUTH_URL;
  if (!appUrl) return;

  const channelId = randomUUID();
  const watchToken = randomBytes(24).toString("hex");

  const res = await client.calendar.events.watch({
    calendarId: "primary",
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${appUrl}/api/webhooks/google-calendar`,
      token: watchToken,
    },
  });

  await prisma.googleCalendarAccount.update({
    where: { userId },
    data: {
      watchChannelId: channelId,
      watchResourceId: res.data.resourceId ?? null,
      watchToken,
      watchExpiresAt: res.data.expiration ? new Date(Number(res.data.expiration)) : null,
    },
  });

  // Un canal nuevo no trae syncToken -- hace falta una vuelta de sync
  // "completa" (filtrada a partir de ahora) solo para conseguirlo; los
  // eventos que devuelve acá se descartan, total v1 no importa nada
  // preexistente del calendario personal (ver el job de sync).
  let pageToken: string | undefined;
  let syncToken: string | null = null;
  do {
    const page = await client.calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      singleEvents: true,
      pageToken,
    });
    pageToken = page.data.nextPageToken ?? undefined;
    if (page.data.nextSyncToken) syncToken = page.data.nextSyncToken;
  } while (pageToken);

  if (syncToken) {
    await prisma.googleCalendarAccount.update({ where: { userId }, data: { syncToken } });
  }
}

export async function stopWatch(userId: string): Promise<void> {
  const account = await prisma.googleCalendarAccount.findUnique({ where: { userId } });
  if (!account?.watchChannelId || !account.watchResourceId) return;
  const client = await getCalendarClientForUser(userId);
  if (!client) return;
  await client.calendar.channels
    .stop({ requestBody: { id: account.watchChannelId, resourceId: account.watchResourceId } })
    .catch(() => {});
}

export async function disconnectGoogleCalendar(userId: string): Promise<void> {
  await stopWatch(userId).catch(() => {});
  await prisma.googleCalendarAccount.delete({ where: { userId } }).catch(() => {});
}

/** Usado por el job de sync (Google → CRM) -- ver jobs/handlers/google-calendar-sync.ts. */
export async function getCalendarForSync(userId: string) {
  return getCalendarClientForUser(userId);
}

/**
 * Los canales de `calendar.events.watch` vencen solos -- en vez de un job
 * que se reprograma a sí mismo (el mismo patrón que se rompió en
 * `vexa_bot_poll`: reprogramarse con la misma uniqueKey se pisa con el DONE
 * posterior), esto se cuelga del cron de un minuto que ya existe
 * (api/cron/tick) -- un chequeo barato, nada que encolar.
 */
export async function renewExpiringGoogleCalendarWatches(): Promise<void> {
  const soon = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const expiring = await prisma.googleCalendarAccount.findMany({
    where: { OR: [{ watchExpiresAt: { lte: soon } }, { watchExpiresAt: null }] },
    select: { userId: true },
  });
  for (const { userId } of expiring) {
    await startWatch(userId).catch((error) => {
      console.warn(`[google-calendar-user] No se pudo renovar la suscripción de ${userId}:`, error);
    });
  }
}
