# Servicio aparte de la app principal — se despliega como otra app en
# Coolify apuntando a este subdirectorio del mismo repo. No comparte nada de
# runtime con el Next.js de arriba: entra a Google Meet, graba el audio y se
# lo devuelve por HTTP a la app principal (ver api/webhooks/meeting-bot).
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Xvfb: pantalla virtual, Chromium la necesita aunque nadie la vea.
# PulseAudio: sink de audio virtual, para "grabar" lo que Chromium reproduce.
# ffmpeg: graba ese sink a un archivo.
# El resto son librerías de sistema que Chromium necesita sin GPU/pantalla real.
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb pulseaudio ffmpeg wget ca-certificates \
    fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
# Chromium (no todos los navegadores de Playwright) para no inflar la imagen
# con Firefox/WebKit que nunca se usan.
RUN npx playwright install --with-deps chromium

COPY . .

# Perfil persistente de Chrome (sesión de la cuenta del bot ya logueada,
# cargada una vez con `npm run login`) y carpeta de grabaciones temporales.
# Montar /data como volumen en Coolify — si no, la sesión se pierde en cada
# redeploy y hay que volver a loguearse a mano.
RUN mkdir -p /data/chrome-profile /tmp/recordings
ENV CHROME_PROFILE_DIR=/data/chrome-profile
ENV RECORDINGS_DIR=/tmp/recordings
ENV PULSE_MONITOR_SOURCE=virtual_sink.monitor
ENV DISPLAY=:99

EXPOSE 4000
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
