import { z } from "zod";
import { prisma } from "@/server/db/client";
import { getCalendarForSync } from "@/server/services/google-calendar-user";

export const googleCalendarSyncPayload = z.object({ userId: z.string() });

/**
 * Lado Google → CRM del sync: agarra lo que cambió desde el último
 * `syncToken` y actualiza SOLO los `Meeting` que ya nacieron en el CRM
 * (matcheados por `googleEventId` + `googleCalendarOwnerId`). Un evento de
 * Calendar sin Meeting correspondiente se ignora a propósito -- alcance v1,
 * ver el plan: no se importan eventos personales sueltos del usuario.
 */
export async function handleGoogleCalendarSync(rawPayload: unknown): Promise<void> {
  const { userId } = googleCalendarSyncPayload.parse(rawPayload);

  const client = await getCalendarForSync(userId);
  if (!client) return; // se desconectó la cuenta entre que se encoló el job y que corrió

  const account = await prisma.googleCalendarAccount.findUnique({ where: { userId }, select: { syncToken: true } });
  let syncToken = account?.syncToken ?? undefined;
  let pageToken: string | undefined;
  let nextSyncToken: string | null = null;

  do {
    let page;
    try {
      page = await client.calendar.events.list({
        calendarId: "primary",
        syncToken,
        pageToken,
        singleEvents: true,
      });
    } catch (error) {
      const status = (error as { code?: number })?.code;
      if (status === 410) {
        // El syncToken venció/es inválido -- no hay forma de "reanudar" desde
        // acá. Se limpia y se corta esta corrida; la próxima notificación de
        // Google dispara un sync sin token (equivalente a arrancar de cero).
        await prisma.googleCalendarAccount.update({ where: { userId }, data: { syncToken: null } });
        return;
      }
      throw error;
    }

    for (const event of page.data.items ?? []) {
      if (!event.id) continue;
      const meeting = await prisma.meeting.findFirst({
        where: { googleEventId: event.id, googleCalendarOwnerId: userId },
        select: { id: true, durationMinutes: true },
      });
      if (!meeting) continue; // no nació en el CRM -- se ignora (alcance v1)

      if (event.status === "cancelled") {
        await prisma.meeting.update({ where: { id: meeting.id }, data: { status: "CANCELED" } });
        continue;
      }

      const start = event.start?.dateTime || event.start?.date;
      const end = event.end?.dateTime || event.end?.date;
      const data: { title?: string; scheduledAt?: Date; durationMinutes?: number } = {};
      if (event.summary) data.title = event.summary;
      if (start) {
        const scheduledAt = new Date(start);
        if (!Number.isNaN(scheduledAt.getTime())) {
          data.scheduledAt = scheduledAt;
          if (end) {
            const endAt = new Date(end);
            if (!Number.isNaN(endAt.getTime())) {
              const minutes = Math.round((endAt.getTime() - scheduledAt.getTime()) / 60_000);
              if (minutes > 0) data.durationMinutes = minutes;
            }
          }
        }
      }
      if (Object.keys(data).length > 0) {
        await prisma.meeting.update({ where: { id: meeting.id }, data });
      }
    }

    pageToken = page.data.nextPageToken ?? undefined;
    if (page.data.nextSyncToken) nextSyncToken = page.data.nextSyncToken;
  } while (pageToken);

  if (nextSyncToken) {
    await prisma.googleCalendarAccount.update({ where: { userId }, data: { syncToken: nextSyncToken } });
  }
}
