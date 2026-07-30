FROM node:24-alpine AS base

# ── Dependencies ────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --include=dev es a propósito: si Coolify (u otra plataforma) inyecta
# NODE_ENV=production también en build-time, npm por defecto omite las
# devDependencies — y entre ellas está @tailwindcss/postcss, que el build
# necesita sí o sí. Esto lo hace robusto sin depender de que alguien marque
# bien el toggle "solo en runtime" para NODE_ENV en la plataforma.
RUN npm ci --include=dev

# ── Build ───────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ── Runtime ─────────────────────────────────────────────────────
# Nota: no usamos el output "standalone" de Next (que solo empaqueta lo
# mínimo para el servidor web), y copiamos TODO el directorio del builder
# (código fuente, tsconfig.json, prisma.config.ts, node_modules completo)
# en vez de listar archivo por archivo — a propósito, para poder correr
# `npx prisma migrate deploy` o `npx tsx prisma/seed.ts` directamente en
# el contenedor desplegado sin descubrir a los golpes qué archivo faltó.
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app ./

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
