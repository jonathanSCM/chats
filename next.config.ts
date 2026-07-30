import type { NextConfig } from "next";

// Sin "output: standalone" a propósito: el contenedor de producción lleva
// node_modules completo (no el bundle recortado de standalone) para poder
// correr scripts administrativos (prisma migrate deploy, seed) directo en
// el contenedor desplegado. Ver Dockerfile.
const nextConfig: NextConfig = {};

export default nextConfig;
