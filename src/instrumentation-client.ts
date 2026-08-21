import * as Sentry from "@sentry/nextjs";

// process.env.NEXT_PUBLIC_* se incrusta en el bundle del navegador en
// tiempo de build — por eso el DSN del cliente necesita ese prefijo,
// distinto de SENTRY_DSN (solo servidor) usado en sentry.server.config.ts.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
