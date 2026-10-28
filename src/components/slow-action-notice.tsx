"use client";

import { useEffect, useState } from "react";

/**
 * Verdadero cuando una acción lleva demasiado tiempo "cargando". La causa típica es una pestaña
 * abierta de antes de un despliegue: Next ya no reconoce la acción vieja y la pantalla se queda
 * en "Guardando…" sin avisar nada.
 */
export function useSlowPending(pending: boolean, afterMs = 15_000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!pending) {
      const reset = window.setTimeout(() => setSlow(false), 0);
      return () => window.clearTimeout(reset);
    }
    const timer = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [pending, afterMs]);
  return slow;
}

export function SlowActionNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="text-xs text-danger">
      Está tardando demasiado. Puede que haya una versión nueva del CRM.{" "}
      <button type="button" onClick={() => window.location.reload()} className="cursor-pointer underline">
        Recargar la página
      </button>{" "}
      y vuelve a intentarlo.
    </p>
  );
}
