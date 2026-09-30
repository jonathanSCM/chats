import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processJobs, enqueue } from "@/server/jobs";
import { renewExpiringGoogleCalendarWatches } from "@/server/services/google-calendar-user";
import { prisma } from "@/server/db/client";

const META_ADS_SYNC_INTERVAL_HOURS = 20;

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
      OR: [{ metaAdsLastSyncedAt: null }, { metaAdsLastSyncedAt: { lt: cutoff } }],
    },
    select: { id: true },
  });

  for (const org of orgs) {
    await enqueue({
      type: "meta_ads_sync",
      payload: { organizationId: org.id },
      uniqueKey: `meta-ads-sync-${org.id}`,
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

  const result = await processJobs();

  // Barato la mayoría de los ticks (sin cuentas por vencer, es un SELECT
  // vacío) -- no vale la pena un job aparte solo para esto.
  await renewExpiringGoogleCalendarWatches().catch((error) => {
    console.error("[cron] Error renovando suscripciones de Google Calendar:", error);
  });

  await syncMetaAdsIfDue().catch((error) => {
    console.error("[cron] Error encolando el sync de Meta Ads:", error);
  });

  return NextResponse.json(result);
}

// Algunos programadores solo saben hacer GET.
export const GET = POST;
