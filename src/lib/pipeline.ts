/**
 * Estados tal como los usa el equipo en su planilla de seguimiento.
 * No son los del manual: si el sistema no habla el idioma del vendedor,
 * termina sin usarse.
 */
export type Stage =
  | "LLAMAR"
  | "ENVIAR_COTI"
  | "COTI_ENVIADA"
  | "REUNION"
  | "NEGOCIACION"
  | "CERRADO"
  | "PERDIDO";

export const STAGE_LABEL: Record<Stage, string> = {
  LLAMAR: "LLAMAR",
  ENVIAR_COTI: "ENVIAR COTI",
  COTI_ENVIADA: "COTI ENVIADA",
  REUNION: "REUNIÓN",
  NEGOCIACION: "NEGOCIACIÓN",
  CERRADO: "CERRADO",
  PERDIDO: "PERDIDO",
};

export const ALL_STAGES: Stage[] = [
  "LLAMAR",
  "ENVIAR_COTI",
  "COTI_ENVIADA",
  "REUNION",
  "NEGOCIACION",
  "CERRADO",
  "PERDIDO",
];

/** Sigue en juego: necesita próximo paso y entra en los conteos. */
export const OPEN_STAGES: Stage[] = [
  "LLAMAR",
  "ENVIAR_COTI",
  "COTI_ENVIADA",
  "REUNION",
  "NEGOCIACION",
];

export function isOpenStage(stage: Stage): boolean {
  return OPEN_STAGES.includes(stage);
}

/** Qué tiene que pasar para salir de cada estado. */
export const STAGE_CRITERIA: Record<Stage, string> = {
  LLAMAR: "Hay que contactarlo o retomar el contacto.",
  ENVIAR_COTI: "Ya se sabe qué necesita; falta armar y mandar la cotización.",
  COTI_ENVIADA: "La cotización está en manos del cliente, esperando respuesta.",
  REUNION: "Hay reunión acordada o en curso.",
  NEGOCIACION: "Se discuten precio, alcance o condiciones.",
  CERRADO: "Acuerdo confirmado.",
  PERDIDO: "No se concretó. Registrar el motivo para aprender de ello.",
};

/** Color por estado, de frío a caliente, para leer la tabla de un vistazo. */
export const STAGE_COLOR: Record<Stage, string> = {
  LLAMAR: "#64748b",
  ENVIAR_COTI: "#ca8a04",
  COTI_ENVIADA: "#ea580c",
  REUNION: "#2563eb",
  NEGOCIACION: "#db2777",
  CERRADO: "#059669",
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
