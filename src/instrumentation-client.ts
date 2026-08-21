import * as Sentry from "@sentry/nextjs";

// process.env.NEXT_PUBLIC_* se incrusta en el bundle del navegador en
// tiempo de build — por eso el DSN del cliente necesita ese prefijo,
// distinto de SENTRY_DSN (solo servidor) usado en sentry.server.config.ts.
//
// Nota: no se activó Session Replay (grabación de pantalla de sesiones) a
// propósito — este panel muestra conversaciones reales de clientes por
// WhatsApp, y grabar la pantalla por defecto expondría esos datos a
// Sentry sin que nadie lo haya decidido explícitamente. Si se quiere más
// adelante, se activa con enmascarado de texto/medios habilitado.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
