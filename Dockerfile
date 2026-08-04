# Debian slim y no Alpine a propósito.
#
# Alpine usa musl, así que npm resuelve `@img/sharp-linuxmusl-*` (con sus
# dependencias `@emnapi/*`), mientras que el CI corre en Ubuntu con glibc y
# resuelve `@img/sharp-linux-x64`. Con dos árboles distintos, `npm ci`
# reventaba en el build por dependencias "Missing from lock file" que el CI
# nunca veía, cada vez que se tocaba una dependencia desde Windows.
# Con glibc, CI y producción resuelven exactamente lo mismo y el CI vuelve a
# ser una barrera de verdad. Cuesta unos MB más de imagen; vale la pena.
FROM node:24-slim AS base

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

# ffmpeg convierte las notas de voz grabadas en el panel: Chrome las graba
# en audio/webm y la Cloud API de WhatsApp solo acepta ogg/opus, mp4, aac,
# amr o mpeg. Sin esto, las notas de voz desde Chrome fallan al enviarse.
# curl viene bien para diagnosticar desde el terminal del contenedor.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg curl openssl \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app ./

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "run", "start"]
