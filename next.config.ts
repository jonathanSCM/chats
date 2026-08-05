import type { NextConfig } from "next";

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

export default nextConfig;
