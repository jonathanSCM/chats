"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { ALL_STAGES, OPEN_STAGES, type Stage } from "@/lib/pipeline";
import type { ActionState } from "./types";

const PATH = "/dashboard/seguimiento";

async function requireOrg() {
  const session = await requireSession();
  if (!session.user.organizationId) throw new Error("Sin organización");
  return { organizationId: session.user.organizationId, userId: session.user.id };
}

const createSchema = z.object({
  contactId: z.string().min(1),
  title: z.string().min(2, "Ponle un título").max(160),
  serviceInterest: z.string().max(160).optional(),
  estimatedValue: z.coerce.number().nonnegative().optional(),
});

export async function createOpportunityAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const parsed = createSchema.safeParse({
    contactId: formData.get("contactId"),
    title: formData.get("title"),
    serviceInterest: formData.get("serviceInterest") || undefined,
    estimatedValue: formData.get("estimatedValue") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const contact = await prisma.contact.findUnique({ where: { id: parsed.data.contactId } });
  if (!contact || contact.organizationId !== organizationId) {
    return { error: "Contacto no encontrado" };
  }

  const created = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId: parsed.data.contactId,
      title: parsed.data.title,
      serviceInterest: parsed.data.serviceInterest ?? null,
      estimatedValue: parsed.data.estimatedValue ?? null,
      assignedToId: userId,
    },
  });

  await audit({
    entityType: "Opportunity",
    entityId: created.id,
    action: "create",
    userId,
    organizationId,
    after: { title: created.title, stage: created.stage },
  });

  revalidatePath(PATH);
  return { error: null, message: "Cliente agregado." };
}

/**
 * Guarda una celda editada en la tabla de seguimiento. Es la forma en que
 * el equipo ya trabaja en su planilla: se corrige el dato en su lugar.
 */
const fieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("stage"), value: z.enum(ALL_STAGES as [Stage, ...Stage[]]) }),
  z.object({ field: z.literal("priority"), value: z.enum(["ALTA", "MEDIA", "BAJA"]) }),
  z.object({ field: z.literal("serviceInterest"), value: z.string().max(160) }),
  z.object({ field: z.literal("needSummary"), value: z.string().max(5000) }),
  z.object({ field: z.literal("lastUpdate"), value: z.string().max(5000) }),
  z.object({ field: z.literal("nextContactAt"), value: z.string() }),
  z.object({ field: z.literal("probability"), value: z.coerce.number().min(0).max(100) }),
  z.object({ field: z.literal("lostReason"), value: z.string().max(500) }),
]);

export async function updateOpportunityFieldAction(
  opportunityId: string,
  field: string,
  value: string,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const parsed = fieldSchema.safeParse({ field, value });
  if (!parsed.success) return { error: "Valor inválido" };

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }

  const now = new Date();
  const data: Record<string, unknown> = {};

  switch (parsed.data.field) {
    case "stage": {
      const stage = parsed.data.value;
      data.stage = stage;
      data.wonAt = stage === "CERRADO" ? now : null;
      data.lostAt = stage === "PERDIDO" ? now : null;
      if (stage === "COTI_ENVIADA" && !opportunity.proposalSentAt) data.proposalSentAt = now;
      break;
    }
    case "nextContactAt":
      data.nextContactAt = parsed.data.value ? new Date(parsed.data.value) : null;
      break;
    case "probability":
      data.probability = Math.round(parsed.data.value);
      break;
    default:
      data[parsed.data.field] = parsed.data.value || null;
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data });

  // Solo se auditan los cambios de estado: son los que después explican el
  // embudo. Auditar cada tecleo de una nota solo generaría ruido.
  if (parsed.data.field === "stage") {
    await audit({
      entityType: "Opportunity",
      entityId: opportunityId,
      action: "stage_change",
      userId,
      organizationId,
      before: { stage: opportunity.stage },
      after: { stage: parsed.data.value },
    });
  }

  revalidatePath(PATH);
  return { error: null };
}

export async function deleteOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }

  await prisma.opportunity.delete({ where: { id: opportunityId } });

  await audit({
    entityType: "Opportunity",
    entityId: opportunityId,
    action: "delete",
    userId,
    organizationId,
    before: { title: opportunity.title, stage: opportunity.stage },
  });

  revalidatePath(PATH);
  return { error: null };
}

export async function completeActivityAction(activityId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity || activity.organizationId !== organizationId) {
    return { error: "Tarea no encontrada" };
  }

  await prisma.activity.update({
    where: { id: activityId },
    data: { status: "DONE", completedAt: new Date() },
  });

  await audit({
    entityType: "Activity",
    entityId: activityId,
    action: "complete",
    userId,
    organizationId,
  });

  revalidatePath(PATH);
  return { error: null };
}

/** Clientes activos sin próximo contacto agendado. */
export async function countWithoutNextContact(organizationId: string): Promise<number> {
  return prisma.opportunity.count({
    where: {
      organizationId,
      stage: { in: OPEN_STAGES },
      nextContactAt: null,
    },
  });
}
