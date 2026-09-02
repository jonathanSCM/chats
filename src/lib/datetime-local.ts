import type { ChangeEvent } from "react";

/**
 * Un <input type="datetime-local"> manda un string sin huso horario (ej.
 * "2026-09-02T23:00") — si el servidor lo interpreta directo con `new
 * Date(...)`, lo toma como UTC (así corre el contenedor), no como la hora
 * local de quien lo cargó. El navegador sí sabe el huso real: acá se
 * convierte a UTC correctamente ANTES de mandarlo, y se guarda en un
 * <input type="hidden" name="scheduledAt"> hermano dentro del mismo <form>.
 *
 * Uso: <input type="datetime-local" onChange={scheduledAtToUtcHidden} /> +
 * <input type="hidden" name="scheduledAt" /> en el mismo form.
 */
export function scheduledAtToUtcHidden(e: ChangeEvent<HTMLInputElement>): void {
  const hidden = e.currentTarget.form?.elements.namedItem("scheduledAt");
  if (!(hidden instanceof HTMLInputElement) || !e.currentTarget.value) return;
  hidden.value = new Date(e.currentTarget.value).toISOString();
}

/**
 * Vuelta del camino inverso: para precargar un <input type="datetime-local">
 * con una fecha que ya está guardada (formato UTC ISO), al editar una
 * reunión existente — el input necesita "YYYY-MM-DDTHH:mm" en hora LOCAL de
 * quien lo mira, no la UTC guardada.
 */
export function utcIsoToLocalInputValue(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
