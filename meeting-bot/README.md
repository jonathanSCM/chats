# meeting-bot

Servicio aparte de la app principal (ZocaloInbox). Entra a una reunión de
Google Meet como invitado (pide unirse, alguien lo admite — igual que
Fireflies, tl;dv, Read.ai y el resto de estas herramientas en su modo
"bot"), la graba, y le devuelve el audio a la app principal por HTTP. No
tiene base de datos propia ni estado persistente — cada reunión abre un
navegador nuevo y descartable, sin ninguna sesión de Google guardada.

**Por qué no hace falta una cuenta de Google logueada**: se probó y
confirmó que Google trata a un navegador controlado por automatización
(Playwright) como invitado sin sesión de todas formas, tenga o no cookies
válidas de una cuenta real — el botón siempre dice "Solicitar unirse", no
"Unirse ahora". Mantener una cuenta logueada no evitaba esa fricción, solo
agregaba mantenimiento (loguearla a mano, guardar el perfil en un volumen,
el riesgo de que Google la banee) y causó un problema real en producción:
un perfil de Chrome persistente lo bloquea Chrome para un solo proceso a la
vez, así que dos reuniones simultáneas hacían fallar la segunda de una.

## Cómo se despliega (Coolify)

Se crea como una **segunda aplicación** en Coolify, apuntando al mismo
repositorio pero con **este subdirectorio** (`meeting-bot/`) como base del
build — no como `docker-compose`, cada app de Coolify es independiente y se
hablan por la red interna de Coolify.

1. Nueva app en Coolify → mismo repo Git → "Base Directory" = `meeting-bot`.
2. Variables de entorno: copiar `.env.example` — `BOT_SERVICE_SECRET` y
   `MEETING_BOT_WEBHOOK_SECRET` tienen que ser **los mismos valores** que ya
   están cargados en la app principal (son el secreto compartido de cada
   lado de la comunicación).
3. No hace falta ningún volumen persistente — el contenedor no guarda nada
   entre reuniones ni entre redeploys.
4. En la app principal, `BOT_SERVICE_URL` apunta a la URL interna que
   Coolify le asigna a esta app (ej. `http://meeting-bot.internal:4000`).

## Endpoints

- `POST /join` — body `{ meetingId, meetingUrl, expectedDurationMinutes, callbackUrl, displayName? }`,
  header `Authorization: Bearer <BOT_SERVICE_SECRET>`. Responde `202` al
  toque; el resultado real (grabación subida o fallo) se reporta después al
  `callbackUrl`. `displayName` es el nombre con el que el bot pide unirse
  (por defecto "Asistente ProShop (grabando)" si no se manda).
- `GET /health` — chequeo simple, sin auth.

## Mantenimiento esperado

Los selectores de Google Meet (botón de "unirse", chat, contador de
participantes) están en `src/join-meeting.ts` y son lo más frágil de todo
esto — Google rediseña la interfaz de Meet sin aviso. Si el bot deja de
poder entrar, mandar el aviso, o detectar el final de la reunión, revisar
esa función primero.
