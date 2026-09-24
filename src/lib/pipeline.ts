import type { PipelineStageRole } from "@/generated/prisma/enums";

/**
 * Etapas del pipeline comercial de ProShop: representan el trabajo pendiente
 * y avanzan con evidencia, no simplemente porque hubo actividad.
 *
 * Desde la migración a pipeline configurable por organización, las etapas
 * viven en la tabla PipelineStage (ver prisma/schema.prisma y
 * src/server/services/pipeline.ts para cargarlas/derivar OPEN/HIDDEN/etc.
 * por organización). Lo que queda acá es SOLO la semilla que usa cada
 * organización nueva (migración de backfill y admin/create-org-form) — no
 * es la fuente de verdad en runtime.
 */
export const DEFAULT_PIPELINE_STAGES: {
  order: number;
  label: string;
  color: string;
  criteria: string;
  role: PipelineStageRole | null;
  isDefaultEntry: boolean;
  requiresProposalFields: boolean;
}[] = [
  {
    order: 1,
    label: "POR CALIFICAR",
    color: "#64748b",
    criteria: "Lead recién llegado; filtro inicial por WhatsApp o llamada.",
    role: null,
    isDefaultEntry: true,
    requiresProposalFields: false,
  },
  {
    order: 2,
    label: "ENTREVISTA",
    color: "#0891b2",
    criteria: "Reunión de levantamiento para entender empresa, proceso, problema e impacto.",
    role: null,
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
  {
    order: 3,
    label: "DIAGNÓSTICO",
    color: "#ca8a04",
    criteria: "Trabajo interno de ProShop para analizar el caso y definir recomendación.",
    role: null,
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
  {
    order: 4,
    label: "PRESENTAR SOLUCIÓN",
    color: "#ea580c",
    criteria: "Reunión con cliente/decisor para mostrar diagnóstico y solución propuesta.",
    role: null,
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
  {
    order: 5,
    label: "PROPUESTA",
    color: "#2563eb",
    criteria: "Preparar/presentar alcance, tiempos, inversión y condiciones.",
    role: null,
    isDefaultEntry: false,
    requiresProposalFields: true,
  },
  {
    order: 6,
    label: "DECISIÓN",
    color: "#db2777",
    criteria: "Seguimiento, objeciones, cambios, negociación y decisión final.",
    role: null,
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
  {
    order: 7,
    label: "GANADO",
    color: "#059669",
    criteria: "Aceptación, firma, pago o inicio del trabajo.",
    role: "WON",
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
  {
    order: 8,
    label: "EN PAUSA / NUTRIR",
    color: "#78716c",
    criteria: "Sin actividad por ahora; se retoma más adelante.",
    role: "NURTURE",
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
  {
    order: 9,
    label: "PERDIDO",
    color: "#dc2626",
    criteria: "No se concretó. Registrar el motivo para aprender de ello.",
    role: "LOST",
    isDefaultEntry: false,
    requiresProposalFields: false,
  },
];

/**
 * Regla dura del scope: toda oportunidad activa debe tener próxima
 * acción, fecha Y responsable — las tres, no solo las primeras dos. Si
 * falta cualquiera, se muestra "⚠️ Sin próxima acción" en toda la app —
 * un único lugar para no repetir la condición.
 */
export function hasCompleteNextAction(row: {
  nextAction: string;
  nextActionAt: string | null;
  assignedTo: unknown;
}): boolean {
  return Boolean(row.nextAction && row.nextActionAt && row.assignedTo);
}

/**
 * Scope §15: al pasar a Propuesta, avisar (no bloquear) si falta
 * información mínima para que la propuesta tenga sentido. Versión pura
 * (client-safe, sin tocar Prisma): recibe directamente el
 * `requiresProposalFields` de la PipelineStage destino en vez del objeto
 * completo — así lo puede llamar tanto el cliente (tracking-table.tsx,
 * kanban-board.tsx) como el servidor
 * (src/server/services/pipeline.ts:missingForStage, que sí toma la
 * PipelineStage resuelta y delega acá).
 */
export function missingForStage(
  requiresProposalFields: boolean,
  row: {
    need: string;
    aiRecommendation: string;
    authorityLevel: string;
    nextAction: string;
    nextActionAt: string | null;
    assignedTo: unknown;
  },
): string[] {
  if (!requiresProposalFields) return [];
  const missing: string[] = [];
  if (!row.need.trim()) missing.push("necesidad identificada");
  if (!row.aiRecommendation.trim()) missing.push("solución definida");
  if (!row.authorityLevel.trim()) missing.push("decisor identificado o aclarado");
  if (!hasCompleteNextAction(row)) missing.push("próxima acción");
  return missing;
}

// STAGE_CRITERIA / STAGE_COLOR: movidos a la tabla PipelineStage
// (columnas `criteria`/`color`, cargadas vía getOrgStages()); ver
// DEFAULT_PIPELINE_STAGES arriba para la semilla de una organización nueva.

export type Priority = "ALTA" | "MEDIA" | "BAJA";

export const PRIORITY_COLOR: Record<Priority, string> = {
  ALTA: "#dc2626",
  MEDIA: "#ca8a04",
  BAJA: "#64748b",
};

/** Servicios de arranque para una organización nueva (ver server/services/services-catalog.ts). */
export const DEFAULT_SERVICES = ["AGENTES IA", "SISTEMAS", "APP", "TAXI"];

export type LossReason =
  | "PRESUPUESTO"
  | "SIN_URGENCIA"
  | "ELIGIO_COMPETENCIA"
  | "NO_RESPONDIO"
  | "PROYECTO_CANCELADO"
  | "NO_FIT"
  | "DECISION_POSTERGADA"
  | "OTRO";

export const ALL_LOSS_REASONS: LossReason[] = [
  "PRESUPUESTO",
  "SIN_URGENCIA",
  "ELIGIO_COMPETENCIA",
  "NO_RESPONDIO",
  "PROYECTO_CANCELADO",
  "NO_FIT",
  "DECISION_POSTERGADA",
  "OTRO",
];

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  PRESUPUESTO: "Presupuesto",
  SIN_URGENCIA: "Sin urgencia",
  ELIGIO_COMPETENCIA: "Eligió competencia",
  NO_RESPONDIO: "No respondió",
  PROYECTO_CANCELADO: "Proyecto cancelado",
  NO_FIT: "No fit",
  DECISION_POSTERGADA: "Decisión postergada",
  OTRO: "Otro",
};
