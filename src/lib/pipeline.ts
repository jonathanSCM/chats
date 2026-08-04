export type Stage =
  | "NEW"
  | "CONTACTED"
  | "QUALIFYING"
  | "MEETING_SCHEDULED"
  | "NEED_CONFIRMED"
  | "PROPOSAL_DRAFT"
  | "PROPOSAL_SENT"
  | "NEGOTIATION"
  | "WON"
  | "LOST"
  | "ON_HOLD";

export const STAGE_LABEL: Record<Stage, string> = {
  NEW: "Nuevo",
  CONTACTED: "Contactado",
  QUALIFYING: "En calificación",
  MEETING_SCHEDULED: "Reunión agendada",
  NEED_CONFIRMED: "Necesidad confirmada",
  PROPOSAL_DRAFT: "Propuesta en preparación",
  PROPOSAL_SENT: "Propuesta enviada",
  NEGOTIATION: "Negociación",
  WON: "Ganado",
  LOST: "Perdido",
  ON_HOLD: "En pausa",
};

/** Criterios de salida de cada etapa (manual §7). Se muestran como ayuda. */
export const STAGE_CRITERIA: Record<Stage, string> = {
  NEW: "Escribió por primera vez y nadie le respondió todavía.",
  CONTACTED: "Ya hubo respuesta del equipo, pero aún no se sabe qué necesita.",
  QUALIFYING: "Se están haciendo las preguntas para entender el problema.",
  MEETING_SCHEDULED: "Hay fecha y hora acordadas con el cliente.",
  NEED_CONFIRMED:
    "Se conocen el problema, el objetivo, quién decide y qué tan urgente es.",
  PROPOSAL_DRAFT: "Se está armando la propuesta con alcance y precio.",
  PROPOSAL_SENT: "La propuesta ya está en manos del cliente.",
  NEGOTIATION: "Se discuten precio, alcance o condiciones.",
  WON: "Cerrado. Hay acuerdo confirmado.",
  LOST: "No se concretó. Registrar el motivo para aprender de ello.",
  ON_HOLD: "Pausado por el cliente, con fecha de retomar.",
};

/** Etapas que siguen en juego: las que necesitan próximo paso (manual §45). */
export const OPEN_STAGES: Stage[] = [
  "NEW",
  "CONTACTED",
  "QUALIFYING",
  "MEETING_SCHEDULED",
  "NEED_CONFIRMED",
  "PROPOSAL_DRAFT",
  "PROPOSAL_SENT",
  "NEGOTIATION",
];

export const ALL_STAGES: Stage[] = [...OPEN_STAGES, "WON", "LOST", "ON_HOLD"];

export function isOpenStage(stage: Stage): boolean {
  return OPEN_STAGES.includes(stage);
}

/** Color por etapa, de frío a caliente, para leer el tablero de un vistazo. */
export const STAGE_COLOR: Record<Stage, string> = {
  NEW: "#64748b",
  CONTACTED: "#0891b2",
  QUALIFYING: "#0d9488",
  MEETING_SCHEDULED: "#2563eb",
  NEED_CONFIRMED: "#7c3aed",
  PROPOSAL_DRAFT: "#ca8a04",
  PROPOSAL_SENT: "#ea580c",
  NEGOTIATION: "#db2777",
  WON: "#059669",
  LOST: "#dc2626",
  ON_HOLD: "#78716c",
};
