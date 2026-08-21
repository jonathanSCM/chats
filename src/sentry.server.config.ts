import * as Sentry from "@sentry/nextjs";

// Sin DSN, Sentry.init() simplemente queda desactivado — no rompe nada en
// local ni en un despliegue que todavía no tenga la variable configurada.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  // 100% en desarrollo (para ver todo mientras se prueba), 10% en
  // producción (para no gastar la cuota de Sentry con tráfico real).
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  // Adjunta valores de variables locales a cada frame del stack trace —
  // ayuda muchísimo a diagnosticar sin tener que reproducir el bug.
  includeLocalVariables: true,
  enableLogs: true,
});
