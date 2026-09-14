"use client";

import { useEffect, useState } from "react";

/**
 * No hay forma simple de confirmar que el content script de la extensión
 * efectivamente leyó el token (correr sin la extensión instalada es un caso
 * válido, ej. alguien entra acá por error) -- se asume éxito después de un
 * momento, igual de "mejor esfuerzo" que el resto de esta extensión.
 */
export function ExtensionAuthorizeBridge() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 1200);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) return null;

  return (
    <p className="mt-6 text-sm text-ink-muted">
      Listo — ya podés cerrar esta pestaña y volver a Meet.
    </p>
  );
}
