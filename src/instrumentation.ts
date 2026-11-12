import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Procesa cada pocos segundos los trabajos del asistente de reuniones (ver fast-loop.ts). No corre en las pruebas ni en el build.
    if (process.env.NODE_ENV === "production" && process.env.FAST_BOT_LOOP !== "0") {
      const { startFastBotLoop } = await import("./server/jobs/fast-loop");
      startFastBotLoop();
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura errores de rutas/acciones del servidor que Next.js reporta a
// través de este hook (además de los que ya se capturan con Sentry.init).
export const onRequestError = Sentry.captureRequestError;
