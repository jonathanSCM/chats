import { z } from "zod";
import { prisma } from "@/server/db/client";
import { audit } from "@/server/services/audit";
import { ApiError, jsonResponse } from "@/server/integrations/http";
import { eventIds, emitIntegrationEvent } from "@/server/integrations/events";
import { readIdempotencyKey, runIdempotent } from "@/server/integrations/idempotency";
import { integrationRoute } from "@/server/integrations/route";
import { serializeOpportunity } from "@/server/integrations/serializers";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  nextAction: z.string().trim().min(1).max(300),
  nextActionAt: z.string().datetime({ offset: true }).nullish(),
  assignedToId: z.string().min(1).nullish(),
});

export const POST = integrationRoute<{ id: string }>("write:activities", async (ctx, req, { id }) => {
  const key = readIdempotencyKey(req);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(422, "validation_error", "El cuerpo no es válido.");
  const input = parsed.data;

  const current = await prisma.opportunity.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, nextAction: true, nextActionAt: true, assignedToId: true },
  });
  if (!current) throw new ApiError(404, "not_found", "Oportunidad no encontrada.");

  if (input.assignedToId) {
    const member = await prisma.organizationMembership.findUnique({
      where: { userId_organizationId: { userId: input.assignedToId, organizationId: ctx.organizationId } },
      select: { id: true },
    });
    if (!member) throw new ApiError(422, "validation_error", "assignedToId no es del equipo de la organización.");
  }

  const outcome = await runIdempotent({
    organizationId: ctx.organizationId,
    key,
    method: "POST",
    path: `/opportunities/${id}/next-action`,
    body: input,
    execute: async (tx) => {
      const updated = await tx.opportunity.update({
        where: { id: current.id },
        data: {
          nextAction: input.nextAction,
          nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
          // Solo reasigna si la integración lo pidió explícitamente.
          ...(input.assignedToId ? { assignedToId: input.assignedToId } : {}),
        },
        select: {
          id: true,
          title: true,
          contactId: true,
          assignedToId: true,
          priority: true,
          estimatedValue: true,
          currency: true,
          nextAction: true,
          nextActionAt: true,
          updatedAt: true,
          stage: { select: { label: true } },
        },
      });
      return { status: 200, body: serializeOpportunity(updated) };
    },
  });

  if (!outcome.replay) {
    const now = new Date();
    await audit({
      entityType: "Opportunity",
      entityId: current.id,
      action: "integration_next_action",
      actor: "SYSTEM",
      organizationId: ctx.organizationId,
      before: { nextAction: current.nextAction, nextActionAt: current.nextActionAt },
      after: { nextAction: input.nextAction, nextActionAt: input.nextActionAt ?? null, keyId: ctx.keyId },
    });
    await emitIntegrationEvent({
      eventId: eventIds.nextActionChanged(current.id, now),
      type: "opportunity.next_action_changed",
      organizationId: ctx.organizationId,
      data: {
        opportunityId: current.id,
        nextAction: input.nextAction,
        nextActionAt: input.nextActionAt ?? null,
        assignedToId: input.assignedToId ?? current.assignedToId,
      },
    });
  }
  return jsonResponse(outcome.body, 200);
});
