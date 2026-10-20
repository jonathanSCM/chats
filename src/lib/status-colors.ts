// Colores de estado compartidos por Dashboard, Tabla y Kanban: el mismo color significa lo mismo
// en todas las pantallas (guía de rediseño §6.2). Rojo solo para vencimientos y problemas reales;
// verde para lo positivo; ámbar para atención; azul para información. Son hex (no variables CSS)
// porque se les agrega transparencia con sufijo (`${color}1a`).
export const STATUS_COLOR = {
  success: "#00a884",
  danger: "#ef4444",
  warning: "#f59e0b",
  orange: "#f97316",
  purple: "#8b5cf6",
  info: "#3b82f6",
  neutral: "#64748b",
} as const;

export function leadScoreColor(score: number): string {
  if (score >= 80) return STATUS_COLOR.success;
  if (score >= 60) return STATUS_COLOR.info;
  if (score >= 40) return STATUS_COLOR.warning;
  return STATUS_COLOR.neutral;
}

/** Color del plazo de una próxima acción: vencido, hoy, mañana. */
export const DUE_COLOR = {
  overdue: STATUS_COLOR.danger,
  today: STATUS_COLOR.warning,
  tomorrow: STATUS_COLOR.info,
} as const;
