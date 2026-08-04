# Debian slim en vez de Alpine: glibc coincide con el runner del CI, trae
# los binarios precompilados de sharp y permite tener curl/openssl a mano
# para diagnosticar desde el terminal del contenedor.
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
#
# El fallback a `npm install` existe porque el lockfile se genera casi
# siempre desde Windows, y npm omite ahí dependencias opcionales que sí hace
# falta instalar en Linux (@emnapi/*, que sharp arrastra). Eso rompía el
# deploy cada vez que se tocaba una dependencia, sin que el desarrollador
# pudiera detectarlo en su máquina. El CI corre `npm ci` en Linux y falla en
# rojo si el lockfile está desincronizado, así que esto no lo tapa: solo
# evita que un detalle de plataforma bloquee un despliegue.
RUN npm ci --include=dev --no-audit --no-fund \
  || (echo "⚠️  Lockfile desincronizado con Linux — instalando con npm install. Corre el workflow 'Refrescar lockfile' para arreglarlo." \
      && npm install --include=dev --no-audit --no-fund)

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
