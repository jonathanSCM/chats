import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura errores de rutas/acciones del servidor que Next.js reporta a
// través de este hook (además de los que ya se capturan con Sentry.init).
export const onRequestError = Sentry.captureRequestError;
