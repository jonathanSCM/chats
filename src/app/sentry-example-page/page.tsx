"use client";

import { useState } from "react";
import * as Sentry from "@sentry/nextjs";

// TEMPORAL: solo para verificar que Sentry está capturando errores en
// producción. Borrar esta carpeta (y src/app/api/sentry-example-api) una
// vez confirmado que los eventos llegan al dashboard de Sentry.
export default function SentryExamplePage() {
  const [serverDone, setServerDone] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        fontFamily: "system-ui, sans-serif",
        background: "#0d0d0f",
        color: "#f5f5f5",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>Prueba de Sentry</h1>
      <p style={{ color: "#a1a1aa", fontSize: 14, maxWidth: 320, textAlign: "center" }}>
        Página temporal. Toca los dos botones y luego revisa tu dashboard de Sentry.
      </p>

      <button
        onClick={() => {
          throw new Error("Sentry test error (navegador) — borrar esta página después de verificar");
        }}
        style={{
          cursor: "pointer",
          padding: "10px 18px",
          borderRadius: 6,
          border: "1px solid #3f3f46",
          background: "#18181b",
          color: "#f5f5f5",
        }}
      >
        1. Provocar error en el navegador
      </button>

      <button
        onClick={async () => {
          setServerError(null);
          setServerDone(false);
          try {
            const res = await fetch("/api/sentry-example-api");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
          } catch (err) {
            // Esperado: la ruta de prueba siempre tira error a propósito.
            Sentry.captureException(err);
            setServerError(err instanceof Error ? err.message : String(err));
          } finally {
            setServerDone(true);
          }
        }}
        style={{
          cursor: "pointer",
          padding: "10px 18px",
          borderRadius: 6,
          border: "1px solid #3f3f46",
          background: "#18181b",
          color: "#f5f5f5",
        }}
      >
        2. Provocar error en el servidor
      </button>

      {serverDone && (
        <p style={{ fontSize: 12, color: "#71717a" }}>
          Petición al servidor completada{serverError ? ` (error: ${serverError})` : ""}.
        </p>
      )}
    </main>
  );
}
