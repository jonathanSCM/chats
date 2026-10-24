import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processJobs, enqueue } from "@/server/jobs";
import { renewExpiringGoogleCalendarWatches } from "@/server/services/google-calendar-user";
import { prisma } from "@/server/db/client";
import { emitSettledMeetingTranscripts } from "@/server/integrations/domain-events";
import { isMarketingEnabled } from "@/lib/features";

// El gasto de HOY cambia durante el día: se refresca varias veces (cada ~5 h), no una.
const META_ADS_SYNC_INTERVAL_HOURS = 5;
const META_ADS_SYNC_BUCKET_HOURS = 6;
const MEETING_SUMMARY_BATCH = 5;
const MEETING_SETTLE_MINUTES = 10;

/**
 * Encola el resumen de IA de las reuniones que ya terminaron de recibir su
 * transcripción y todavía no tienen resumen. También sirve de relleno de
 * las anteriores. Las ya resumidas se actualizan a mano desde la pantalla.
 * Pocas por tick para no pegar un pico de gasto de IA.
 */
async function enqueueMeetingSummaries(): Promise<void> {
  if (process.env.AI_ENABLED === "false" || !process.env.OPENAI_API_KEY) return;

  const settledBefore = new Date(Date.now() - MEETING_SETTLE_MINUTES * 60_000);
  const candidates = await prisma.meeting.findMany({
    where: {
      updatedAt: { lt: settledBefore },
      scheduledAt: { lt: settledBefore },
      OR: [{ transcript: { not: null } }, { audioTranscript: { not: null } }],
      aiSummaryAt: null,
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: MEETING_SUMMARY_BATCH,
  });

  const day = new Date().toISOString().slice(0, 10);
  for (const m of candidates) {
    await enqueue({
      type: "meeting_summary",
      payload: { meetingId: m.id },
      uniqueKey: `meeting-summary-${m.id}-${day}`,
    });
  }
}

/**
 * Encola el sync de gasto de Meta Ads para cada organización que tenga
 * cuenta publicitaria configurada y no se haya sincronizado en las últimas
 * ~20h (o nunca) -- mismo patrón que renewExpiringGoogleCalendarWatches
 * más abajo. uniqueKey evita encolar dos veces si el tick anterior todavía
 * no terminó de procesar el job.
 */
async function syncMetaAdsIfDue(): Promise<void> {
  const cutoff = new Date(Date.now() - META_ADS_SYNC_INTERVAL_HOURS * 60 * 60 * 1000);

  const orgs = await prisma.organization.findMany({
    where: {
      metaAdAccountId: { not: null },
      metaAdsAccessToken: { not: null },
      OR: [{ metaAdsLastSyncedAt: null }, { metaAdsLastSyncedAt: { lt: cutoff } }],
    },
    select: { id: true },
  });

  for (const org of orgs) {
    await enqueue({
      type: "meta_ads_sync",
      payload: { organizationId: org.id },
      // Con fecha en la clave: una clave fija chocaba para siempre con un job
      // viejo ya terminado o fallido y el sync nunca volvía a encolarse.
      uniqueKey: `meta-ads-sync-${org.id}-${new Date().toISOString().slice(0, 10)}-${Math.floor(new Date().getUTCHours() / META_ADS_SYNC_BUCKET_HOURS)}`,
    });
  }
}

/**
 * Latido de la cola. Lo invoca una Scheduled Task de Coolify cada minuto:
 *
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://tu-dominio/api/cron/tick
 *
 * En la práctica el webhook ya dispara el procesamiento al instante; este
 * endpoint es la red de seguridad para reintentos y trabajos diferidos
 * (debounce del análisis, recordatorios, reportes).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[cron] CRON_SECRET no está configurada — rechazando.");
    return new NextResponse("Not configured", { status: 503 });
  }

  const provided = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const expectedBuf = Buffer.from(secret);
  const providedBuf = Buffer.from(provided);
  const authorized =
    expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);

  if (!authorized) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Avisos al integrador antes de procesar la cola: así salen en este mismo tick.
  await emitSettledMeetingTranscripts().catch((error) => {
    console.error("[cron] Error emitiendo transcripciones de reuniones:", error);
  });

  const result = await processJobs();

  // Barato la mayoría de los ticks (sin cuentas por vencer, es un SELECT
  // vacío) -- no vale la pena un job aparte solo para esto.
  await renewExpiringGoogleCalendarWatches().catch((error) => {
    console.error("[cron] Error renovando suscripciones de Google Calendar:", error);
  });

  await enqueueMeetingSummaries().catch((error) => {
    console.error("[cron] Error encolando resúmenes de reuniones:", error);
  });

  if (isMarketingEnabled()) {
    await syncMetaAdsIfDue().catch((error) => {
      console.error("[cron] Error encolando el sync de Meta Ads:", error);
    });
  }

  return NextResponse.json(result);
}

// Algunos programadores solo saben hacer GET.
export const GET = POST;
