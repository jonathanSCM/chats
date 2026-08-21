import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Sin "output: standalone" a propósito: el contenedor de producción lleva
// node_modules completo (no el bundle recortado de standalone) para poder
// correr scripts administrativos (prisma migrate deploy, seed) directo en
// el contenedor desplegado. Ver Dockerfile.
const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // El límite de Next.js por defecto es 1MB — muy por debajo de una
      // sola foto de celular. El tope real por tipo (5MB imagen, 16MB
      // video/audio, 100MB documento) ya se valida dentro de
      // sendInboxAttachmentAction; este solo evita que Next corte el
      // request antes de que esa validación llegue a correr.
      bodySizeLimit: "105mb",
    },
  },
};

// La subida de source maps a Sentry es opcional: sin SENTRY_AUTH_TOKEN
// configurado, el plugin simplemente la salta (con un aviso), no rompe el
// build — así el proyecto sigue compilando en cualquier entorno que todavía
// no tenga Sentry conectado.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Sube más archivos del cliente para que los stack traces del navegador
  // se lean mejor (no solo los que Next.js cree que hacen falta).
  widenClientFileUpload: true,
  // Crea /monitoring como proxy propio para mandar los reportes — evita
  // que un ad-blocker del vendedor/cliente los bloquee por ir directo a
  // un dominio de sentry.io. El middleware (src/proxy.ts) ya solo aplica
  // a /admin y /dashboard, así que /monitoring no necesita excluirse ahí.
  tunnelRoute: "/monitoring",
  silent: !process.env.CI,
});
