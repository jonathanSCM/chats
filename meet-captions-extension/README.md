# Extensión de subtítulos de Meet — ProShop CRM

Lee los subtítulos en vivo de Google Meet desde el navegador de quien esté en la reunión (no un
bot separado) y manda la transcripción al CRM cuando la reunión termina. Es una función **aparte**
del bot grabador (`meeting-bot/`) — ese sigue existiendo para cuando sí hace falta la grabación de
audio real.

## Cómo funciona

**No graba nada sola.** Hay que activarla a mano en cada reunión que se quiera grabar:

1. Entrá a la reunión de Meet como siempre.
2. Tocá el ícono de la extensión → "Grabar esta reunión".
3. Recién ahí prende los subtítulos de Meet (en español) si no estaban prendidos, y aparece el
   indicador chico abajo a la izquierda ("ProShop CRM — subtítulos: N líneas").
4. Lee el panel de subtítulos cada 2 segundos y arma líneas `Nombre: lo que dijo`.
5. Detecta que la reunión terminó (mismo criterio que el bot: el contador de "Personas" baja a 1
   o desaparece) y manda la transcripción a `POST /api/extension/transcript`.
6. Si se cierra la pestaña antes de detectar el fin, manda lo acumulado hasta ese momento como
   red de seguridad (`sendBeacon`) — pero solo si se había activado la grabación en el paso 2.

Si no se toca "Grabar esta reunión", esa pestaña de Meet no manda absolutamente nada al CRM.

Si el link de la reunión ya estaba agendado en el CRM, la transcripción se suma a esa reunión.
Si no, se crea una nueva reunión **"Reunión Extensión"** — igual que hace "Unir el bot ya mismo"
con llamadas en vivo sin agendar, pero con un nombre distinto para que se distinga de un vistazo.

## Audio real (para whisper.cpp) — opcional, además de los subtítulos

Al tocar "Grabar esta reunión" también se intenta grabar el audio real (lo que dicen los demás
participantes, capturado con `chrome.tabCapture`, mezclado con tu propio micrófono) y mandarlo a
whisper.cpp -- reutiliza el mismo whisper.cpp que ya corre en `meeting-bot/`, no lo duplica. Es
**best-effort**: si el audio falla por lo que sea, los subtítulos de arriba siguen funcionando
igual, no se cae toda la grabación por esto.

**Paso único antes de la primera vez**: abrí el ícono de la extensión → "Activar micrófono (una
sola vez)". Chrome tiene que pedir permiso de micrófono desde acá porque la grabación de audio en
sí corre en una página invisible de la extensión (un "offscreen document") que no puede mostrar
ese diálogo. Sin este paso, igual se graba el audio, pero solo se escucha lo que dicen los demás,
no tu propia voz.

El audio se sube como adjunto a la reunión (`grabacion-extension.webm`) y, si whisper.cpp pudo
transcribirlo, también queda como `audioTranscript` (con su .txt aparte) — la misma distinción que
ya existe para el bot grabador: `transcript` (subtítulos, con nombre de quién habló) y
`audioTranscript` (whisper, sin nombres, tapa los huecos que los subtítulos puedan tener).

## Instalación (uso interno, sin publicar en la Chrome Web Store)

1. Abrí `chrome://extensions` en Chrome.
2. Activá "Modo de programador" (arriba a la derecha).
3. Tocá "Cargar descomprimida" y seleccioná esta carpeta (`meet-captions-extension/`).
4. Tocá el ícono de la extensión (arriba a la derecha del navegador) → pegá el token que
   generás en el CRM en **Organización → "Extensión de subtítulos para Meet"** → "Guardar token".
5. Entrá a una reunión de Meet, tocá el ícono de la extensión de nuevo, y tocá
   **"Grabar esta reunión"**. Sin este paso no se graba nada.

Cada vendedor que quiera usarla instala la extensión una vez en su propio Chrome y pega el mismo
token de la organización (no es un token por persona).

## Por qué este método y no un bot

Investigado y confirmado contra la documentación de productos como Read.ai, Fireflies y Tactiq:
un bot que entra como invitado a la llamada necesita que alguien lo admita y depende de la
configuración de Google Workspace del organizador — la misma fricción que tuvimos con
`meeting-bot/`. Leer los subtítulos desde el navegador de alguien que YA está adentro de la
reunión evita ese problema por completo, al costo de no tener grabación de audio (Meet no
reproduce tu propio micrófono de vuelta en tu pestaña, así que no se puede armar la grabación
completa sin pedir un segundo permiso de micrófono y mezclar las dos fuentes — se dejó fuera de
esta primera versión a propósito).

## Publicar en la Chrome Web Store (opcional, a futuro)

Con solo 1-2 vendedores usándola, no hace falta — "Cargar descomprimida" alcanza. Si en algún
momento se quiere distribuir más fácil (sin que cada persona repita los pasos de arriba), se
puede subir a la Chrome Web Store como extensión **no listada** (unlisted) o **privada**
(restringida a la organización de Google Workspace), sin pasar por la revisión pública.
