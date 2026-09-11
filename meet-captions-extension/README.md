# Extensión de subtítulos de Meet — ProShop CRM

Lee los subtítulos en vivo de Google Meet desde el navegador de quien esté en la reunión (no un
bot separado) y manda la transcripción al CRM cuando la reunión termina. Es una función **aparte**
del bot grabador (`meeting-bot/`) — ese sigue existiendo para cuando sí hace falta la grabación de
audio real.

## Cómo funciona

1. Se activa sola al entrar a cualquier reunión de `meet.google.com/xxx-xxxx-xxx`.
2. Prende los subtítulos de Meet (en español) si no estaban prendidos.
3. Lee el panel de subtítulos cada 2 segundos y arma líneas `Nombre: lo que dijo`.
4. Detecta que la reunión terminó (mismo criterio que el bot: el contador de "Personas" baja a 1
   o desaparece) y manda la transcripción a `POST /api/extension/transcript`.
5. Si se cierra la pestaña antes de detectar el fin, manda lo acumulado hasta ese momento como
   red de seguridad (`sendBeacon`).

Si el link de la reunión ya estaba agendado en el CRM, la transcripción se suma a esa reunión.
Si no, se crea una nueva reunión "(extensión de subtítulos)" — igual que hace "Unir el bot ya
mismo" con llamadas en vivo sin agendar.

## Instalación (uso interno, sin publicar en la Chrome Web Store)

1. Abrí `chrome://extensions` en Chrome.
2. Activá "Modo de programador" (arriba a la derecha).
3. Tocá "Cargar descomprimida" y seleccioná esta carpeta (`meet-captions-extension/`).
4. Tocá el ícono de la extensión (arriba a la derecha del navegador) → pegá el token que
   generás en el CRM en **Organización → "Extensión de subtítulos para Meet"** → Guardar.
5. Entrá a cualquier reunión de Meet normal. Vas a ver un indicador chico abajo a la izquierda
   ("ProShop CRM — subtítulos: N líneas") mientras esté grabando.

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
