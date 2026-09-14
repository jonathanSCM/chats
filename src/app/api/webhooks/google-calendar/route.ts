import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";
import { enqueueOrReschedule, runJobsSoon } from "@/server/jobs";

/**
 * Notificación push de Google Calendar (calendar.events.watch) -- sin
 * cuerpo, todo viaje en headers. `X-Goog-Resource-State: sync` es el aviso
 * inicial al crear el canal (no hay nada que sincronizar todavía, solo hay
 * que responder 200). El resto ("exists") dispara el job de verdad. Mismo
 * patrón de secreto propio + constante-time que api/webhooks/meeting-bot.
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const token = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");

  if (!channelId || !token) {
    return new NextResponse("Falta encabezado de canal", { status: 400 });
  }

  const account = await prisma.googleCalendarAccount.findFirst({
    where: { watchChannelId: channelId },
    select: { userId: true, watchToken: true },
  });
  if (!account?.watchToken) {
    return new NextResponse("Canal desconocido", { status: 404 });
  }

  const expectedBuf = Buffer.from(account.watchToken);
  const providedBuf = Buffer.from(token);
  const authorized = expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
  if (!authorized) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (resourceState === "sync") {
    return NextResponse.json({ ok: true });
  }

  // uniqueKey por usuario: varias notificaciones seguidas (Google manda una
  // por cada cambio, y en ráfaga puede mandar varias juntas) se juntan en un
  // solo job en vez de procesarse una por una.
  await enqueueOrReschedule({
    type: "google_calendar_sync",
    uniqueKey: `google-calendar-sync-${account.userId}`,
    payload: { userId: account.userId },
  });
  runJobsSoon();

  return NextResponse.json({ ok: true });
}
