/**
 * Etapas del pipeline comercial de ProShop: representan el trabajo pendiente
 * y avanzan con evidencia, no simplemente porque hubo actividad.
 */
export type Stage =
  | "POR_CALIFICAR"
  | "ENTREVISTA"
  | "DIAGNOSTICO"
  | "PRESENTAR_SOLUCION"
  | "PROPUESTA"
  | "DECISION"
  | "GANADO"
  | "EN_PAUSA_NUTRIR"
  | "PERDIDO";

export const STAGE_LABEL: Record<Stage, string> = {
  POR_CALIFICAR: "POR CALIFICAR",
  ENTREVISTA: "ENTREVISTA",
  DIAGNOSTICO: "DIAGNÓSTICO",
  PRESENTAR_SOLUCION: "PRESENTAR SOLUCIÓN",
  PROPUESTA: "PROPUESTA",
  DECISION: "DECISIÓN",
  GANADO: "GANADO",
  EN_PAUSA_NUTRIR: "EN PAUSA / NUTRIR",
  PERDIDO: "PERDIDO",
};

export const ALL_STAGES: Stage[] = [
  "POR_CALIFICAR",
  "ENTREVISTA",
  "DIAGNOSTICO",
  "PRESENTAR_SOLUCION",
  "PROPUESTA",
  "DECISION",
  "GANADO",
  "EN_PAUSA_NUTRIR",
  "PERDIDO",
];

/** Sigue en juego: necesita próximo paso y entra en los conteos/KPIs. */
export const OPEN_STAGES: Stage[] = [
  "POR_CALIFICAR",
  "ENTREVISTA",
  "DIAGNOSTICO",
  "PRESENTAR_SOLUCION",
  "PROPUESTA",
  "DECISION",
];

/** Fuera del flujo principal: no aparecen por defecto en Seguimiento comercial. */
export const HIDDEN_BY_DEFAULT_STAGES: Stage[] = ["GANADO", "PERDIDO", "EN_PAUSA_NUTRIR"];

export function isOpenStage(stage: Stage): boolean {
  return OPEN_STAGES.includes(stage);
}

/** Qué significa cada etapa y cuándo corresponde usarla — tooltip por etapa. */
export const STAGE_CRITERIA: Record<Stage, string> = {
  POR_CALIFICAR: "Lead recién llegado; filtro inicial por WhatsApp o llamada.",
  ENTREVISTA: "Reunión de levantamiento para entender empresa, proceso, problema e impacto.",
  DIAGNOSTICO: "Trabajo interno de ProShop para analizar el caso y definir recomendación.",
  PRESENTAR_SOLUCION: "Reunión con cliente/decisor para mostrar diagnóstico y solución propuesta.",
  PROPUESTA: "Preparar/presentar alcance, tiempos, inversión y condiciones.",
  DECISION: "Seguimiento, objeciones, cambios, negociación y decisión final.",
  GANADO: "Aceptación, firma, pago o inicio del trabajo.",
  EN_PAUSA_NUTRIR: "Sin actividad por ahora; se retoma más adelante.",
  PERDIDO: "No se concretó. Registrar el motivo para aprender de ello.",
};

/** Color por estado, de frío a caliente, para leer la tabla/Kanban de un vistazo. */
export const STAGE_COLOR: Record<Stage, string> = {
  POR_CALIFICAR: "#64748b",
  ENTREVISTA: "#0891b2",
  DIAGNOSTICO: "#ca8a04",
  PRESENTAR_SOLUCION: "#ea580c",
  PROPUESTA: "#2563eb",
  DECISION: "#db2777",
  GANADO: "#059669",
  EN_PAUSA_NUTRIR: "#78716c",
  PERDIDO: "#dc2626",
};

export type Priority = "ALTA" | "MEDIA" | "BAJA";

export const PRIORITY_COLOR: Record<Priority, string> = {
  ALTA: "#dc2626",
  MEDIA: "#ca8a04",
  BAJA: "#64748b",
};

/** Servicios que ofrece la empresa, como los escribe el equipo. */
export const SERVICES = ["AGENTES IA", "SISTEMAS", "APP", "TAXI"] as const;
