"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { VENDOR_COLOR_PALETTE } from "@/lib/vendor-color";
import type { ActionState } from "./types";

const PATH = "/dashboard/organization";

async function requireOwner() {
  const session = await requireSession();
  if (session.user.role !== "OWNER" || !session.user.organizationId) {
    throw new Error("Solo el dueño de la organización puede cambiar esto");
  }
  return session.user.organizationId;
}

async function getOwnedStage(organizationId: string, stageId: string) {
  const stage = await prisma.pipelineStage.findUnique({ where: { id: stageId } });
  if (!stage || stage.organizationId !== organizationId) return null;
  return stage;
}

const labelSchema = z.object({ label: z.string().trim().min(1, "Requerido").max(40) });

/** Etapa nueva, editable, al final del orden actual -- nunca lleva rol protegido. */
export async function createPipelineStageAction(label: string): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const parsed = labelSchema.safeParse({ label });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const stages = await prisma.pipelineStage.findMany({ where: { organizationId }, select: { order: true } });
  const nextOrder = stages.length ? Math.max(...stages.map((s) => s.order)) + 1 : 0;
  const color = VENDOR_COLOR_PALETTE[stages.length % VENDOR_COLOR_PALETTE.length];

  await prisma.pipelineStage.create({
    data: { organizationId, label: parsed.data.label, color, order: nextOrder },
  });

  revalidatePath(PATH);
  return { error: null };
}

export async function renamePipelineStageAction(stageId: string, label: string): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const parsed = labelSchema.safeParse({ label });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const stage = await getOwnedStage(organizationId, stageId);
  if (!stage) return { error: "Etapa no encontrada" };

  // El rol (Ganado/Perdido/Nutrir) se identifica por su `role`, no por el
  // texto -- se puede renombrar libremente sin romper la lógica que depende
  // de él (ver crm.ts, meta-conversions.ts).
  await prisma.pipelineStage.update({ where: { id: stageId }, data: { label: parsed.data.label } });

  revalidatePath(PATH);
  return { error: null };
}

const colorSchema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido") });

export async function recolorPipelineStageAction(stageId: string, color: string): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const parsed = colorSchema.safeParse({ color });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };

  const stage = await getOwnedStage(organizationId, stageId);
  if (!stage) return { error: "Etapa no encontrada" };

  await prisma.pipelineStage.update({ where: { id: stageId }, data: { color: parsed.data.color } });

  revalidatePath(PATH);
  return { error: null };
}

/** Intercambia el orden con la etapa vecina -- mover una empuja a la otra, nunca dos etapas comparten el mismo `order`. */
export async function movePipelineStageAction(stageId: string, direction: "up" | "down"): Promise<ActionState> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const stages = await prisma.pipelineStage.findMany({ where: { organizationId }, orderBy: { order: "asc" } });
  const index = stages.findIndex((s) => s.id === stageId);
  if (index === -1) return { error: "Etapa no encontrada" };

  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (swapIndex < 0 || swapIndex >= stages.length) return { error: null };

  const a = stages[index];
  const b = stages[swapIndex];
  await prisma.$transaction([
    // Paso intermedio a un valor fuera de rango: evita chocar contra el
    // `@@unique([organizationId, order])` mientras las dos filas todavía no
    // terminaron de actualizarse.
    prisma.pipelineStage.update({ where: { id: a.id }, data: { order: -1 } }),
    prisma.pipelineStage.update({ where: { id: b.id }, data: { order: a.order } }),
    prisma.pipelineStage.update({ where: { id: a.id }, data: { order: b.order } }),
  ]);

  revalidatePath(PATH);
  return { error: null };
}

/**
 * Borra una etapa editable (sin rol protegido). Si tiene oportunidades,
 * exige `reassignToStageId` -- nunca se borran oportunidades como efecto
 * secundario de reordenar el pipeline. Si la que se borra era la entrada
 * por defecto de leads nuevos, ese rol pasa a la etapa editable que quede
 * con el orden más bajo.
 */
export async function deletePipelineStageAction(
  stageId: string,
  reassignToStageId?: string,
): Promise<ActionState & { opportunityCount?: number }> {
  let organizationId: string;
  try {
    organizationId = await requireOwner();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "No autorizado" };
  }

  const stage = await getOwnedStage(organizationId, stageId);
  if (!stage) return { error: "Etapa no encontrada" };
  if (stage.role) return { error: "Esta etapa es parte del sistema (Ganado/Perdido/Nutrir) y no se puede borrar." };

  const otherStages = await prisma.pipelineStage.findMany({
    where: { organizationId, id: { not: stageId } },
    orderBy: { order: "asc" },
  });
  if (otherStages.filter((s) => s.role === null).length === 0) {
    return { error: "Tiene que quedar al menos una etapa editable en el pipeline." };
  }

  const opportunityCount = await prisma.opportunity.count({ where: { stageId } });
  if (opportunityCount > 0) {
    if (!reassignToStageId) {
      return { error: null, opportunityCount };
    }
    const target = otherStages.find((s) => s.id === reassignToStageId);
    if (!target) return { error: "Etapa de destino inválida" };
    await prisma.opportunity.updateMany({ where: { stageId }, data: { stageId: reassignToStageId } });
  }

  await prisma.$transaction(async (tx) => {
    await tx.pipelineStage.delete({ where: { id: stageId } });
    if (stage.isDefaultEntry) {
      const newDefault = otherStages.find((s) => s.role === null);
      if (newDefault) {
        await tx.pipelineStage.update({ where: { id: newDefault.id }, data: { isDefaultEntry: true } });
      }
    }
  });

  revalidatePath(PATH);
  return { error: null };
}
