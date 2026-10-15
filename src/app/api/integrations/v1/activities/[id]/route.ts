import { z } from "zod";
import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { ApiError, jsonResponse } from "@/server/integrations/http";
import { eventIds, emitIntegrationEvent } from "@/server/integrations/events";
import { integrationRoute } from "@/server/integrations/route";
import { serializeActivity } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    status: z.enum(["PENDING", "DONE", "CANCELED"]),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    assignedToId: z.string().min(1).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Enviá al menos un campo.");

export const PATCH = integrationRoute<{ id: string }>("write:activities", async (ctx, req, { id }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "validation_error", "El cuerpo no es válido.");
  const input = parsed.data;

  const current = await prisma.activity.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!current) throw new ApiError(404, "not_found", "Tarea no encontrada.");

  if (input.assignedToId) {
    const member = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: input.assignedToId, organizationId: ctx.organizationId } },
      select: { id: true },
    });
    if (!member) throw new ApiError(422, "validation_error", "assignedToId no es del equipo de la organización.");
  }

  const completing = input.status === "DONE" && current.status !== "DONE";
  const updated = await prisma.activity.update({
    where: { id: current.id },
    data: {
      ...(input.status !== undefined
        ? { status: input.status, completedAt: input.status === "DONE" ? (current.completedAt ?? new Date()) : null }
        : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      ...(input.assignedToId !== undefined ? { assignedToId: input.assignedToId } : {}),
    },
  });

  await audit({
    entityType: "Activity",
    entityId: updated.id,
    action: "integration_update",
    actor: "SYSTEM",
    organizationId: ctx.organizationId,
    before: { status: current.status, dueAt: current.dueAt, assignedToId: current.assignedToId },
    after: { status: updated.status, dueAt: updated.dueAt, assignedToId: updated.assignedToId, keyId: ctx.keyId },
  });
  if (completing) {
    await emitIntegrationEvent({
      eventId: eventIds.activityCompleted(updated.id),
      type: "activity.completed",
      organizationId: ctx.organizationId,
      data: { activityId: updated.id, ...serializeActivity(updated) },
    });
  }
  return jsonResponse(serializeActivity(updated));
});
