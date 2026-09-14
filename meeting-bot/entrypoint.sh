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
# El sink null a veces se crea muteado o a volumen bajo por defecto — si
# eso pasa, Chromium "reproduce" bien pero ffmpeg graba silencio real
# (la causa más común de un audio grabado que pesa lo esperado pero no
# suena nada). Fuerza volumen y desmuteo explícitos por las dudas.
pactl set-sink-mute virtual_sink 0
pactl set-sink-volume virtual_sink 100%

exec npm run start
