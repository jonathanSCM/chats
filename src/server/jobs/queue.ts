import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

export interface EnqueueOptions {
  type: string;
  payload: Record<string, unknown>;
  /**
   * Si se repite, el job no se duplica. Sirve para que el reintento de un
   * webhook de Meta o un tick solapado no genere trabajo doble (manual §37).
   */
  uniqueKey?: string;
  /** Para trabajos diferidos: debounce del análisis, recordatorios, etc. */
  runAfter?: Date;
  maxAttempts?: number;
}

export async function enqueue(options: EnqueueOptions): Promise<void> {
  const { type, payload, uniqueKey, runAfter, maxAttempts } = options;

  try {
    await prisma.job.create({
      data: {
        type,
        payload: payload as Prisma.InputJsonValue,
        uniqueKey,
        runAfter: runAfter ?? new Date(),
        maxAttempts: maxAttempts ?? 5,
      },
    });
  } catch (error) {
    // P2002 en uniqueKey: ya estaba encolado. Es exactamente lo que se busca.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return;
    }
    throw error;
  }
}

/**
 * Reprograma un job existente por uniqueKey, o lo crea si no existe.
 * Es la base del debounce: cada mensaje nuevo empuja hacia adelante el
 * análisis de esa conversación en vez de encolar uno por mensaje.
 */
export async function enqueueOrReschedule(options: EnqueueOptions & { uniqueKey: string }) {
  const { type, payload, uniqueKey, runAfter, maxAttempts } = options;
  const when = runAfter ?? new Date();

  await prisma.job.upsert({
    where: { uniqueKey },
    create: {
      type,
      payload: payload as Prisma.InputJsonValue,
      uniqueKey,
      runAfter: when,
      maxAttempts: maxAttempts ?? 5,
    },
    update: {
      // Solo se reprograma si sigue pendiente; si ya corrió, se deja quieto.
      runAfter: when,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

export interface ClaimedJob {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/**
 * Toma hasta `limit` trabajos listos y los marca RUNNING de forma atómica.
 *
 * FOR UPDATE SKIP LOCKED es la clave: si dos ticks corren a la vez (el cron y
 * el disparo inmediato del webhook), cada uno se lleva filas distintas en vez
 * de pelearse por las mismas o bloquearse.
 */
export async function claimJobs(limit: number): Promise<ClaimedJob[]> {
  // NOW() AT TIME ZONE 'UTC' y no NOW() a secas: las columnas son
  // `timestamp` sin zona y Prisma escribe siempre en UTC, mientras que NOW()
  // devuelve la hora local del servidor. Comparar contra NOW() directamente
  // desfasa los trabajos tantas horas como offset tenga la base.
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE "jobs"
    SET "status" = 'RUNNING',
        "lockedAt" = (NOW() AT TIME ZONE 'UTC'),
        "attempts" = "attempts" + 1,
        "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE "id" IN (
      SELECT "id" FROM "jobs"
      WHERE "status" = 'PENDING'
        AND "runAfter" <= (NOW() AT TIME ZONE 'UTC')
      ORDER BY "runAfter" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "type", "payload", "attempts", "maxAttempts"
  `;
  return rows;
}

export async function completeJob(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: "DONE", completedAt: new Date(), lastError: null },
  });
}

export async function failJob(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;

  if (exhausted) {
    await prisma.job.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: message },
    });
    return;
  }

  // Espera progresiva: 1, 2, 4, 8… minutos (manual §36).
  const delayMinutes = Math.pow(2, job.attempts - 1);
  await prisma.job.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      lastError: message,
      lockedAt: null,
      runAfter: new Date(Date.now() + delayMinutes * 60_000),
    },
  });
}

/**
 * Devuelve al estado pendiente los trabajos que quedaron RUNNING colgados
 * (por ejemplo, si el contenedor se reinició a mitad de un job).
 */
export async function requeueStaleJobs(olderThanMinutes = 10): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const result = await prisma.job.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: cutoff } },
    data: { status: "PENDING", lockedAt: null },
  });
  return result.count;
}
