"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

/**
 * Hora del SERVIDOR, no la del navegador — útil para comparar contra la
 * hora local a simple vista cuando algo de fechas/huso horario no cierra
 * (ver el bug de reuniones que se guardaban 4hs corridas).
 *
 * Avanza desde el instante que mandó el servidor usando performance.now()
 * (un reloj monótono), no `new Date()` del navegador — así el tick sigue
 * siendo fiel a la hora del servidor aunque el reloj de la PC del usuario
 * esté mal configurado, que es justo el tipo de cosa que este componente
 * ayuda a detectar.
 */
export function ServerClock({ initialIso, timeZone }: { initialIso: string; timeZone: string }) {
  const [display, setDisplay] = useState("");

  useEffect(() => {
    const serverStartMs = new Date(initialIso).getTime();
    const mountedAt = performance.now();

    function tick() {
      const now = new Date(serverStartMs + (performance.now() - mountedAt));
      setDisplay(now.toLocaleTimeString("es", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [initialIso, timeZone]);

  return (
    <p
      className="nav-extra flex items-center gap-1.5 pl-[26px] text-xs text-[var(--sidebar-ink)]/70"
      title={`Hora del servidor (huso horario: ${timeZone})`}
    >
      <Clock size={12} className="shrink-0" /> {display || "…"}
    </p>
  );
}
