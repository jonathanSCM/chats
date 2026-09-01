import { randomUUID } from "node:crypto";
import { google } from "googleapis";

/**
 * Una sola cuenta de Google (GOOGLE_BOT_REFRESH_TOKEN), compartida por toda
 * la organización, crea el evento de Calendar — por eso queda como
 * organizadora de la reunión y Meet nunca le pide "admitir" a nadie cuando
 * esa misma cuenta se une después como bot de grabación.
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

export async function createMeetEvent({
  summary,
  scheduledAt,
  durationMinutes,
}: {
  summary: string;
  scheduledAt: Date;
  durationMinutes: number;
}): Promise<string> {
  const calendar = google.calendar({ version: "v3", auth: getOAuthClient() });
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  const res = await calendar.events.insert({
    calendarId: "primary",
    conferenceDataVersion: 1,
    requestBody: {
      summary,
      start: { dateTime: scheduledAt.toISOString() },
      end: { dateTime: endAt.toISOString() },
      conferenceData: {
        createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
      },
    },
  });

  const link = res.data.hangoutLink;
  if (!link) throw new Error("Google Calendar no devolvió un link de Meet para el evento creado.");
  return link;
}
