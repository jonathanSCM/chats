// Compartido entre el panel de detalle de reuniones internas
// (adhoc-meetings-client.tsx) y el de reuniones de un cliente
// (tracking-table.tsx) para que ambos se vean como el mismo componente.

/** Franja de color arriba del panel: grabando/falló en rojo, el resto el verde de acento. */
export function panelAccent(botStatus: string | null): string {
  if (botStatus === "RECORDING" || botStatus === "FAILED") return "var(--danger)";
  return "var(--accent)";
}

export const PILL_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";
