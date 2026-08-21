"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// Red de seguridad de último nivel: si algo revienta en el render y ningún
// error.tsx más específico lo atajó, esto reemplaza el <html> entero — por
// eso no puede depender de layout.tsx ni de estilos globales que quizás no
// llegaron a cargar.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0d0d0f",
          color: "#f5f5f5",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 380, padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Algo salió mal</p>
          <p style={{ fontSize: 14, color: "#a1a1aa", marginBottom: 20 }}>
            Ya quedó registrado. Puedes intentar de nuevo.
          </p>
          <button
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #3f3f46",
              background: "#18181b",
              color: "#f5f5f5",
              fontSize: 14,
            }}
          >
            Reintentar
          </button>
        </div>
      </body>
    </html>
  );
}
