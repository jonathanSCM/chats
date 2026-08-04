"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { ALL_STAGES, isOpenStage, type Stage } from "@/lib/pipeline";
import type { ActionState } from "./types";

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

  revalidatePath("/dashboard/pipeline");
  return { error: null, message: "Oportunidad creada." };
}

const stageSchema = z.object({
  stage: z.enum(ALL_STAGES as [Stage, ...Stage[]]),
  lostReason: z.string().max(500).optional(),
});

export async function changeStageAction(
  opportunityId: string,
  stage: Stage,
  lostReason?: string,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const parsed = stageSchema.safeParse({ stage, lostReason });
  if (!parsed.success) return { error: "Etapa inválida" };

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Oportunidad no encontrada" };
  }

  // El manual (§7) pide registrar por qué se perdió: sin eso, el reporte de
  // motivos de pérdida queda vacío y no se aprende nada.
  if (parsed.data.stage === "LOST" && !parsed.data.lostReason?.trim()) {
    return { error: "Indica el motivo de la pérdida" };
  }

  const now = new Date();
  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      stage: parsed.data.stage,
      wonAt: parsed.data.stage === "WON" ? now : null,
      lostAt: parsed.data.stage === "LOST" ? now : null,
      lostReason: parsed.data.stage === "LOST" ? parsed.data.lostReason : null,
      proposalSentAt:
        parsed.data.stage === "PROPOSAL_SENT" && !opportunity.proposalSentAt
          ? now
          : opportunity.proposalSentAt,
    },
  });

  await audit({
    entityType: "Opportunity",
    entityId: opportunityId,
    action: "stage_change",
    userId,
    organizationId,
    before: { stage: opportunity.stage },
    after: { stage: parsed.data.stage },
  });

  revalidatePath("/dashboard/pipeline");
  return { error: null };
}

const nextActionSchema = z.object({
  nextAction: z.string().min(2, "Describe el próximo paso").max(300),
  nextActionAt: z.string().optional(),
});

export async function setNextActionAction(
  opportunityId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const parsed = nextActionSchema.safeParse({
    nextAction: formData.get("nextAction"),
    nextActionAt: formData.get("nextActionAt") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Oportunidad no encontrada" };
  }

  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      nextAction: parsed.data.nextAction,
      nextActionAt: parsed.data.nextActionAt ? new Date(parsed.data.nextActionAt) : null,
    },
  });

  // Todo próximo paso con fecha se refleja como tarea, para que entre en los
  // recordatorios y en el reporte diario.
  if (parsed.data.nextActionAt) {
    await prisma.activity.create({
      data: {
        organizationId,
        opportunityId,
        contactId: opportunity.contactId,
        assignedToId: opportunity.assignedToId ?? userId,
        type: "FOLLOW_UP",
        title: parsed.data.nextAction,
        dueAt: new Date(parsed.data.nextActionAt),
      },
    });
  }

  revalidatePath("/dashboard/pipeline");
  return { error: null, message: "Próximo paso guardado." };
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

  revalidatePath("/dashboard/pipeline");
  return { error: null };
}

/** Oportunidades activas sin próximo paso definido — la regla dura del manual §45. */
export async function countOpportunitiesWithoutNextAction(
  organizationId: string,
): Promise<number> {
  return prisma.opportunity.count({
    where: {
      organizationId,
      stage: { in: ALL_STAGES.filter(isOpenStage) },
      nextAction: null,
    },
  });
}
