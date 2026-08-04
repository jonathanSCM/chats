import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processJobs } from "@/server/jobs";

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
  return NextResponse.json(result);
}

// Algunos programadores solo saben hacer GET.
export const GET = POST;
