# meeting-bot

Servicio aparte de la app principal (ZocaloInbox). Entra a una reunión de
Google Meet con la cuenta de Google compartida, la graba, y le devuelve el
audio a la app principal por HTTP. No tiene base de datos propia ni estado
persistente más allá del perfil de Chrome logueado — es un ejecutor.

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
3. Montar un **volumen persistente** en `/data` (perfil de Chrome logueado)
   — sin esto, cada redeploy pierde la sesión y hay que volver a loguearse.
4. En la app principal, `BOT_SERVICE_URL` apunta a la URL interna que
   Coolify le asigna a esta app (ej. `http://meeting-bot.internal:4000`).

## Primer login (una sola vez, obligatorio antes de usarlo)

El contenedor no tiene ninguna sesión de Google guardada al desplegarse por
primera vez. Hay que loguearse a mano, una vez, con la cuenta del bot:

```bash
# Con el contenedor corriendo, entrar a una shell dentro de él:
docker exec -it <container> sh
npm run login
```

Esto abre Chrome dentro del contenedor (necesita acceso por VNC o X11
forwarding para verlo — si Coolify no da eso fácil, la alternativa es correr
`npm run login` **en una máquina local con pantalla**, apuntando
`CHROME_PROFILE_DIR` a una carpeta local, loguearse ahí, y después copiar esa
carpeta al volumen `/data` del contenedor en producción).

Puede pedir verificación en dos pasos la primera vez — resolverla con la
cuenta del bot como se haría normalmente. Una vez logueada, la sesión queda
guardada y el contenedor la reusa en cada reunión sin volver a pedir nada,
salvo que alguien la revoque desde la cuenta de Google
(myaccount.google.com/permissions).

## Endpoints

- `POST /join` — body `{ meetingId, meetingUrl, expectedDurationMinutes, callbackUrl }`,
  header `Authorization: Bearer <BOT_SERVICE_SECRET>`. Responde `202` al
  toque; el resultado real (grabación subida o fallo) se reporta después al
  `callbackUrl`.
- `GET /health` — chequeo simple, sin auth.

## Mantenimiento esperado

Los selectores de Google Meet (botón de "unirse", chat, contador de
participantes) están en `src/join-meeting.ts` y son lo más frágil de todo
esto — Google rediseña la interfaz de Meet sin aviso. Si el bot deja de
poder entrar, mandar el aviso, o detectar el final de la reunión, revisar
esa función primero.
