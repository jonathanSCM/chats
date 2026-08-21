import * as Sentry from "@sentry/nextjs";

// Sin DSN, Sentry.init() simplemente queda desactivado — no rompe nada en
// local ni en un despliegue que todavía no tenga la variable configurada.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
