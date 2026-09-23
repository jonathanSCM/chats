import { prisma } from "@/server/db/client";
import type { PipelineStageRole } from "@/generated/prisma/enums";
import { missingForStage as missingForStagePure } from "@/lib/pipeline";

/**
 * Etapa del pipeline comercial, ahora configurable por organización (ver
 * prisma/schema.prisma:PipelineStage). Reemplaza el viejo `Stage` (string
 * union fijo) de src/lib/pipeline.ts en todo lo que necesita resolver
 * comportamiento real (ganado/perdido/propuesta) — ese archivo solo
 * conserva DEFAULT_PIPELINE_STAGES como semilla para organizaciones nuevas.
 */
export interface PipelineStage {
  id: string;
  organizationId: string;
  label: string;
  color: string;
  criteria: string;
  order: number;
  role: PipelineStageRole | null;
  isDefaultEntry: boolean;
  requiresProposalFields: boolean;
}

/** Etapas de una organización, ordenadas como se muestran en Kanban/tabla. */
export async function getOrgStages(organizationId: string): Promise<PipelineStage[]> {
  return prisma.pipelineStage.findMany({
    where: { organizationId },
    orderBy: { order: "asc" },
  });
}

/** Sigue en juego: necesita próximo paso y entra en los conteos/KPIs (antes OPEN_STAGES). */
export function openStages(stages: PipelineStage[]): PipelineStage[] {
  return stages.filter((s) => s.role === null);
}

/** Fuera del flujo principal: no aparecen por defecto en Seguimiento comercial (antes HIDDEN_BY_DEFAULT_STAGES). */
export function hiddenByDefaultStages(stages: PipelineStage[]): PipelineStage[] {
  return stages.filter((s) => s.role !== null);
}

export function wonStage(stages: PipelineStage[]): PipelineStage | undefined {
  return stages.find((s) => s.role === "WON");
}

export function lostStage(stages: PipelineStage[]): PipelineStage | undefined {
  return stages.find((s) => s.role === "LOST");
}

export function nurtureStage(stages: PipelineStage[]): PipelineStage | undefined {
  return stages.find((s) => s.role === "NURTURE");
}

/** Dónde caen los leads nuevos (antes el default de columna Postgres POR_CALIFICAR). */
export function defaultEntryStage(stages: PipelineStage[]): PipelineStage | undefined {
  return stages.find((s) => s.isDefaultEntry) ?? stages[0];
}

export function isOpenStage(stage: Pick<PipelineStage, "role">): boolean {
  return stage.role === null;
}

/**
 * Scope §15: al pasar a Propuesta, avisar (no bloquear) si falta
 * información mínima para que la propuesta tenga sentido. Antes chequeaba
 * `stage === "PROPUESTA"` por nombre; ahora la propia PipelineStage dice si
 * exige estos campos (`requiresProposalFields`), sin atarse a un id fijo.
 */
export function missingForStage(
  stage: Pick<PipelineStage, "requiresProposalFields">,
  row: {
    need: string;
    aiRecommendation: string;
    authorityLevel: string;
    nextAction: string;
    nextActionAt: string | null;
    assignedTo: unknown;
  },
): string[] {
  return missingForStagePure(stage.requiresProposalFields, row);
}
