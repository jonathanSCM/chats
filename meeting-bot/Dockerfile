# Servicio aparte de la app principal — se despliega como otra app en
# Coolify apuntando a este subdirectorio del mismo repo. No comparte nada de
# runtime con el Next.js de arriba: entra a Google Meet, graba el audio y se
# lo devuelve por HTTP a la app principal (ver api/webhooks/meeting-bot).

# Stage aparte solo para compilar whisper.cpp -- transcripción de audio local
# y gratis (reemplaza la llamada paga a la API de Whisper de OpenAI que se
# usaba antes), sin arrastrar todo el toolchain de compilación (git, cmake,
# g++) a la imagen final.
FROM node:24-slim AS whisper-builder
RUN apt-get update && apt-get install -y --no-install-recommends git cmake g++ make wget ca-certificates \
  && rm -rf /var/lib/apt/lists/*
# Tag fija por reproducibilidad -- si el build falla por un cambio de layout
# en un release más nuevo, es el primer lugar para mirar.
# -DBUILD_SHARED_LIBS=OFF: sin esto, whisper-cli queda linkeado contra
# libwhisper.so/libggml*.so (confirmado con un fallo real en producción:
# "error while loading shared libraries: libwhisper.so.1") -- copiar solo el
# binario al stage final no alcanza sin también copiar y ubicar bien esas
# librerías. Estático es más simple: un solo archivo, sin nada que enlazar
# en tiempo de ejecución.
RUN git clone --depth 1 --branch v1.7.4 https://github.com/ggerganov/whisper.cpp /opt/whisper.cpp \
  && cmake -B /opt/whisper.cpp/build -S /opt/whisper.cpp -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  && cmake --build /opt/whisper.cpp/build --config Release -j"$(nproc)"
# Modelo cuantizado "base" -- liviano y anda bien en CPU sin GPU; menos
# preciso que "small"/"medium", aceptable porque esto es un complemento de
# respaldo, no la fuente principal de transcripción (esa son los subtítulos
# en vivo de Meet, ver captions.ts).
RUN mkdir -p /opt/whisper-model \
  && wget -q -O /opt/whisper-model/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin

FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Xvfb: pantalla virtual, Chromium la necesita aunque nadie la vea.
# PulseAudio: sink de audio virtual, para "grabar" lo que Chromium reproduce.
# ffmpeg: graba ese sink a un archivo, y también convierte el mp3 grabado a
# WAV para whisper.cpp (transcribe-audio.ts).
# libgomp1: whisper.cpp la necesita en tiempo de ejecución (usa OpenMP para
# paralelizar) -- sin ella el binario compilado en el stage anterior no corre.
# El resto son librerías de sistema que Chromium necesita sin GPU/pantalla real.
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb pulseaudio ffmpeg wget ca-certificates libgomp1 \
    fonts-liberation libnss3 libatk-bridge2.0-0 libgtk-3-0 libgbm1 libasound2 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-builder /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-builder /opt/whisper-model/ggml-base.bin /opt/whisper-model/ggml-base.bin
ENV WHISPER_CPP_BIN=/usr/local/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/opt/whisper-model/ggml-base.bin

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
