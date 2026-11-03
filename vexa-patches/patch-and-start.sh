#!/bin/sh
# Wrapper de entrypoint para vexa-lite: aplica el parche de subtítulos de
# Meet (idempotente) y después sigue con el arranque normal de la imagen
# (Xvfb/pulseaudio/provisioning, ver /entrypoint.sh original) -- si el
# parche falla por lo que sea, el bot arranca igual, solo que sin la
# captura extra de subtítulos (Whisper sigue funcionando normal).
set -u

node /patches/apply-patch.js /app/core/meetings/services/bot/dist/capture-bridge.js || \
  echo "[proshop-patch] Falló el parche (no fatal, el bot arranca igual) -- ver el log de arriba."

node /patches/apply-min-stay.js /app/core/meetings/services/bot/dist/aloneness.js || echo "[proshop-min-stay] Fallo el parche (no fatal)."

node /patches/apply-shots.js /app/core/meetings/modules/join/dist || echo "[proshop-shots] Fallo el parche de capturas (no fatal)."

exec /entrypoint.sh "$@"
