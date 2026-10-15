import { z } from "zod";
import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { ApiError, jsonResponse } from "@/server/integrations/http";
import { eventIds, emitIntegrationEvent } from "@/server/integrations/events";
import { readIdempotencyKey, runIdempotent } from "@/server/integrations/idempotency";
import { integrationRoute } from "@/server/integrations/route";
import { serializeActivity } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  type: z.enum(["TASK", "CALL", "MESSAGE", "PROPOSAL", "FOLLOW_UP"]),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).nullish(),
  dueAt: z.string().datetime({ offset: true }).nullish(),
  assignedToId: z.string().min(1).nullish(),
  opportunityId: z.string().min(1).nullish(),
  contactId: z.string().min(1).nullish(),
  // Lo que mande el integrador se ignora: una tarea creada por API siempre es "ai".
  source: z.string().optional(),
});

export const POST = integrationRoute("write:activities", async (ctx, req) => {
  const key = readIdempotencyKey(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "validation_error", "El cuerpo no cumple el esquema de la tarea.");
  const input = parsed.data;

  // Todo lo referenciado debe ser de la propia organización (si no: 422, no se revela de quién es).
  if (input.assignedToId) {
    const member = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: input.assignedToId, organizationId: ctx.organizationId } },
      select: { id: true },
    });
    if (!member) throw new ApiError(422, "validation_error", "assignedToId no es del equipo de la organización.");
  }
  if (input.opportunityId) {
    const o = await prisma.opportunity.findFirst({
      where: { id: input.opportunityId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!o) throw new ApiError(422, "validation_error", "opportunityId no existe en la organización.");
  }
  if (input.contactId) {
    const c = await prisma.contact.findFirst({
      where: { id: input.contactId, organizationId: ctx.organizationId },
      select: { id: true },
    });
    if (!c) throw new ApiError(422, "validation_error", "contactId no existe en la organización.");
  }

  const outcome = await runIdempotent({
    organizationId: ctx.organizationId,
    key,
    method: "POST",
    path: "/activities",
    body: { ...input, source: undefined },
    execute: async (tx) => {
      const activity = await tx.activity.create({
        data: {
          organizationId: ctx.organizationId,
          type: input.type,
          title: input.title,
          description: input.description ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          assignedToId: input.assignedToId ?? null,
          opportunityId: input.opportunityId ?? null,
          contactId: input.contactId ?? null,
          source: "ai",
        },
      });
      return { status: 201, body: serializeActivity(activity) };
    },
  });

  if (!outcome.replay) {
    const created = outcome.body as ReturnType<typeof serializeActivity>;
    await audit({
      entityType: "Activity",
      entityId: created.id,
      action: "integration_create",
      actor: "SYSTEM",
      organizationId: ctx.organizationId,
      after: { title: created.title, keyId: ctx.keyId },
    });
    await emitIntegrationEvent({
      eventId: eventIds.activityCreated(created.id),
      type: "activity.created",
      organizationId: ctx.organizationId,
      data: { activityId: created.id, ...created },
    });
  }
  return jsonResponse(outcome.body, outcome.status);
});
