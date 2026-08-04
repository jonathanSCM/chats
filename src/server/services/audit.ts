import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db/client";

type Actor = "USER" | "SYSTEM" | "AI";

interface AuditEntry {
  entityType: string;
  entityId: string;
  action: string;
  actor?: Actor;
  userId?: string | null;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * Deja constancia de un cambio. Nunca lanza: perder una línea de auditoría
 * es malo, pero tumbar la operación que la generó es peor.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actor: entry.actor ?? "USER",
        userId: entry.userId ?? null,
        organizationId: entry.organizationId ?? null,
        before: (entry.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: (entry.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    console.error("[audit] No se pudo registrar la auditoría:", error);
  }
}
