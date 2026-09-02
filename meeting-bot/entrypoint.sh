#!/bin/sh
set -e

# Pantalla virtual — Chromium necesita una, aunque nadie la vea nunca.
Xvfb :99 -screen 0 1280x720x24 &
sleep 1

# Sink de audio virtual — Chromium "reproduce" el audio de la reunión ahí
# adentro, y ffmpeg graba el "monitor" de ese mismo sink (record-audio.ts).
pulseaudio -D --exit-idle-time=-1 --disallow-exit
pactl load-module module-null-sink sink_name=virtual_sink
pactl set-default-sink virtual_sink
pactl set-default-source virtual_sink.monitor

# El candado de Chrome (SingletonLock/-Socket/-Cookie) identifica al
# contenedor que lo escribió por hostname — como cada redeploy es un
# contenedor nuevo con hostname distinto, Chrome ve el candado del anterior
# y rechaza abrir el perfil pensando que "otra computadora" lo está usando.
# Solo corre una instancia del bot a la vez, así que cualquier candado que
# quede al arrancar es de una corrida vieja: se limpia siempre.
rm -f "${CHROME_PROFILE_DIR:-/data/chrome-profile}"/Singleton*

exec npm run start
