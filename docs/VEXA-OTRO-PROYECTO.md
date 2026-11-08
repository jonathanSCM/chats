# Usar el mismo Vexa desde otro proyecto (sin redesplegarlo)

Fecha: 6-nov-2026. Basado en lo que hay **instalado hoy** en el servidor (`vexaai/vexa-lite:v012`, contenedor `vexa-lite-hl0su07v75qoulyqoyjx2nrw`), leído del propio código y de su API. No se cambió nada en Vexa para escribir esto.

## Respuesta corta

**Sí se puede, sin redesplegar ni reiniciar Vexa.** Vexa ya es multiusuario: cada usuario tiene su **propia clave de API**, sus **propias reuniones** y su **propio webhook**. El otro proyecto:

1. recibe su propia clave (se crea una vez, con la API de administración de Vexa);
2. llama a `POST /bots` con esa clave para mandar el asistente a una reunión;
3. recibe un **webhook firmado** en su propio servidor cuando la reunión termina;
4. pide la transcripción con `GET /transcripts/by-id/{id}` (y el audio con `/recordings`).

Todo eso ya existe en la imagen actual. Lo que **no** se puede hacer sin tocar Vexa es lo que dependa de los parches del CRM (ver "El peligro: los parches son globales").

## Cómo queda el flujo

```
 Otro proyecto ──(1) POST /bots  [X-API-Key: clave del otro proyecto]──▶ Vexa (gateway :8056)
                                                                          │ entra a la reunión y transcribe
 Otro proyecto ◀─(2) AVISO: webhook "meeting.completed" (opcional) ───────┘   (solo avisa; no trae el audio)
                   …o preguntar cada 15 s: GET /bots (como hace el CRM)
 Otro proyecto ──(3) GET /transcripts/by-id/{id}  [misma clave]──────────▶ Vexa → texto (segments) + datos del audio
 Otro proyecto ──(4) GET playback_url.audio → raw_url → archivo de audio ▶ Vexa → audio (.webm)
```

El CRM (ProShop) sigue igual con **su** usuario de Vexa (usuario 2 hoy). Cada usuario solo ve sus reuniones.

## Qué le devuelve Vexa al otro proyecto (datos, rutas, archivos)

**Respuesta directa: Vexa no "empuja" ni el audio ni la transcripción.** Lo único que puede empujar es un **aviso** (webhook) de que algo pasó. La transcripción y el audio **los pide el otro proyecto** cuando quiere, con su clave, a rutas del gateway. Así lo hace el CRM hoy (no usa webhooks: pregunta cada 15 s hasta que la reunión termina; ver `src/server/jobs/handlers/vexa-bot-poll.ts`).

Todo lo marcado ✅ está **verificado**: lo hace el CRM en producción hoy. Lo marcado ⚠️ no lo pude comprobar (ver al final).

Todas las rutas son del **gateway** (`https://<gateway>`), con la cabecera `X-API-Key: <clave del otro proyecto>`:

| # | Qué | Ruta | Qué devuelve |
|---|---|---|---|
| 1 ✅ | Mandar el asistente | `POST /bots` con `{platform, native_meeting_id, bot_name, language}` | Un JSON con el **id de la sesión** (número entero; el CRM lo lee de `id`, `meeting_id` o `meeting.id`). Guárdalo: con él se pide todo lo demás. |
| 2 ✅ | Estado de las sesiones | `GET /bots` | `{ meetings: [ … ] }`, una entrada por sesión (ver "Campos de la sesión"). |
| 3 ✅ | **Transcripción** (texto) | `GET /transcripts/by-id/{id}` | `{ segments: [ { speaker, text, … } ], recordings: [ { id, playback_url: { audio } } ] }` |
| 4 ✅ | **Audio**, paso 1 | `GET {gateway}{recordings[].playback_url.audio}` | Un JSON con `raw_url` (la dirección del archivo). |
| 5 ✅ | **Audio**, paso 2 | `GET raw_url` (si empieza con `/`, anteponer el gateway) | El **archivo de audio** (en el CRM llega como `audio/webm`; se guarda como `grabacion.webm`). |
| 6 ✅ | Transcripción por sala | `GET /transcripts/google_meet/{native_meeting_id}` | Igual que la 3, pero mezcla todas las sesiones de esa sala (úsala solo si no tienes el id). |
| 7 ✅ | Detener el asistente | `DELETE /bots/google_meet/{native_meeting_id}` | — |
| 8 ✅ | Buscar en transcripciones | `GET /transcripts/search` | ⚠️ formato no verificado. |

### Campos de la sesión (`GET /bots` → `meetings[]`) ✅

| Campo | Qué es |
|---|---|
| `id` | Id de la sesión (el mismo del `POST /bots`). |
| `status` | Estado. En curso: se une, `awaiting_admission` (sala de espera), `active` (grabando). Cualquier otro (`completed`, `failed`, `error`…) es **terminal**. |
| `native_meeting_id`, `platform` | Código de la reunión (`abc-defg-hij`) y plataforma (`google_meet`). |
| `created_at`, `updated_at` | Fechas ISO. |
| `failure_stage` | Si falló: en qué etapa (`joining`, `awaiting_admission`…). Vacío si salió bien. |
| `completion_reason` | Por qué terminó. |
| `data.join_evidence.reason` | Motivo técnico si no pudo entrar: `awaiting_admission_timeout` (nadie lo admitió en 15 min), `awaiting_admission_rejected`, `never_reached_lobby`… |

### Campos de la transcripción (`segments[]`) ✅ solo estos dos

- `speaker`: nombre del que habla (puede venir vacío; el CRM pone `?`).
- `text`: lo dicho.

Vexa probablemente trae más por segmento (tiempos de inicio/fin, idioma…), pero **no lo verifiqué**: míralo con el comando de abajo antes de depender de ello.

### Los archivos que acaban en el otro proyecto

Vexa no deja archivos en el otro proyecto: **los crea el otro proyecto** a partir de las respuestas. El CRM, por ejemplo, arma:

| Archivo (en el CRM) | De dónde sale |
|---|---|
| `transcripcion-audio-whisper.txt` | Los `segments` unidos como `Nombre: texto`, una línea por segmento (descartando frases inventadas por Whisper en los silencios). |
| `grabacion.webm` | El audio de las rutas 4 y 5. |
| `subtitulos-meet.txt` | **No viene de Vexa**: son los subtítulos de Meet que manda el parche (ver "El peligro" más abajo). El otro proyecto **no** los recibe, solo recibiría la transcripción de audio (Whisper). |

### El webhook (opcional) = solo un aviso

Si el otro proyecto prefiere no preguntar cada pocos segundos, Vexa le avisa por webhook (configuración en el paso 2). Formato ✅ (leído del código de Vexa): `{ event_id, event_type, api_version, created_at, data }`, con las cabeceras de firma `X-Webhook-Timestamp` y `X-Webhook-Signature`. Eventos: `meeting.completed`, `meeting.started`, `meeting.status_change`.

⚠️ **No verifiqué qué trae `data`.** Trátalo como un aviso ("la sesión X terminó") y, al recibirlo, **pide la transcripción y el audio con las rutas 3–5**. No asumas que el texto o el audio vienen dentro del webhook.

### Comprobarlo con tus propios ojos (2 minutos)

Con la clave del otro proyecto y una reunión de prueba terminada (`<id>` = el id de la sesión):

```bash
curl -s https://<gateway>/transcripts/by-id/<id> -H "X-API-Key: <clave>" | jq '{claves: keys, segmento: .segments[0], grabaciones: .recordings}'
curl -s https://<gateway>/bots -H "X-API-Key: <clave>" | jq '.meetings[0]'
```

Eso muestra los campos **reales** (tiempos, idioma, etc.) y sirve para completar esta tabla.

## Paso a paso

### 0. Antes de empezar (importante)

- **Que el gateway tenga HTTPS.** Hoy el gateway (`:8056`) está publicado en la IP pública del servidor por HTTP (`http://<ip>:8056`), así que las claves de API viajan sin cifrar. Para otro proyecto, ponle un dominio con HTTPS (Coolify/Traefik delante del puerto 8056) y usa esa URL. No hace falta tocar Vexa.
- **Aislar los parches del CRM** (sección siguiente). Sin eso, las reuniones del otro proyecto también se envían al CRM.

### 1. Crear el usuario y su clave

La API de administración (`:8001`) **no está publicada**: solo se alcanza desde dentro del servidor. Se necesita la variable `ADMIN_API_TOKEN` del contenedor (no la copies a ningún chat ni repositorio).

```bash
ssh root@<servidor>
docker exec -it vexa-lite-hl0su07v75qoulyqoyjx2nrw sh

# dentro del contenedor (la cabecera X-Admin-API-Key está confirmada en el código; los campos del usuario, email y name, son los habituales: confirma el esquema en localhost:8001/docs)
curl -s -X POST localhost:8001/admin/users \
  -H "X-Admin-API-Key: $ADMIN_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"otro-proyecto@tu-dominio.com","name":"Otro proyecto"}'
#  → devuelve el id del usuario (p. ej. 7)

curl -s -X POST localhost:8001/admin/users/7/tokens \
  -H "X-Admin-API-Key: $ADMIN_API_TOKEN"
#  → devuelve la clave del otro proyecto (se muestra una sola vez: guárdala en su gestor de secretos)
```

Rutas disponibles en esa API (verificadas): `POST /admin/users`, `GET /admin/users/email/{email}`, `GET|PATCH /admin/users/{id}`, `POST|GET /admin/users/{id}/tokens`, `DELETE /admin/tokens/{id}`.

**Límite de bots a la vez:** cada usuario tiene `max_concurrent_bots` (3 por defecto). Se cambia con `PATCH /admin/users/{id}`. Pónselo a propósito: todos los bots corren en el **mismo** servidor (8 núcleos, 24 GB) y cada navegador de bot consume bastante. Hoy conviene no pasar de 3 por usuario ni de ~6 en total sin medir.

### 2. Configurar el webhook del otro proyecto (con **su** clave)

```bash
curl -s -X PUT https://<gateway-con-https>/user/webhook \
  -H "X-API-Key: <clave del otro proyecto>" -H "Content-Type: application/json" \
  -d '{
        "webhook_url": "https://otro-proyecto.com/webhooks/vexa",
        "webhook_secret": "<un secreto largo y aleatorio>",
        "webhook_events": { "meeting.completed": true, "meeting.status_change": true }
      }'

curl -s https://<gateway-con-https>/user/webhook -H "X-API-Key: <clave>"   # comprobar (el secreto sale enmascarado)
curl -s https://<gateway-con-https>/user/webhook/deliveries -H "X-API-Key: <clave>"   # historial de envíos y errores
```

Qué hace Vexa (verificado en su código):

- **Eventos:** `meeting.completed` (el único activo por defecto), `meeting.started` y `meeting.status_change` (estado: se une, en sala de espera, activo, terminado, fallido…). Se eligen con `webhook_events`.
- **Formato:** JSON `{ event_id, event_type, api_version, created_at, data }`.
- **Firma:** cabeceras `X-Webhook-Timestamp` y `X-Webhook-Signature: sha256=<hmac_sha256(secret, "<timestamp>." + cuerpo)>`. El otro proyecto **debe verificarla** (ejemplo abajo).
- **Reintentos:** si el servidor responde 5xx o no contesta, Vexa reintenta con espera creciente (cola con backoff). Responde 2xx rápido y procesa después.
- **Protección SSRF:** la URL del webhook **no puede** apuntar a localhost, redes privadas, ni nombres internos de Docker; tiene que ser un dominio público con HTTPS. (Si el otro sistema está en el mismo servidor, usa su dominio público, no `http://contenedor:3000`.)

### 3. Mandar el asistente a una reunión

```bash
curl -s -X POST https://<gateway-con-https>/bots \
  -H "X-API-Key: <clave del otro proyecto>" -H "Content-Type: application/json" \
  -d '{ "platform": "google_meet", "native_meeting_id": "abc-defg-hij",
        "bot_name": "Asistente de Otro Proyecto", "language": "es" }'
```

La respuesta es **201** con el id de la sesión: guárdalo.

- Estos cuatro campos son los que usa el CRM hoy y funcionan. Vexa acepta más opciones (por ejemplo grabación y transcripción); su esquema exacto no está publicado en la API: pruébalas con una reunión de prueba antes de depender de ellas.
- **El código de la reunión es el de Meet** (`abc-defg-hij`, sin la URL).
- **Una sala solo admite un asistente a la vez** en todo Vexa: si el CRM ya mandó uno a esa sala, el otro proyecto recibe `409`. Dos sistemas no pueden grabar la misma reunión simultáneamente.
- **Entrada a Meet:** igual que con el CRM, el asistente entra como invitado y **alguien debe admitirlo** (sala de espera de hasta 15 min). Ver `docs/INVESTIGACION-asistente-de-reuniones.md`.
- Estado en vivo: `GET /bots/status`, o los webhooks `meeting.status_change`.
- Detener: `DELETE /bots/google_meet/abc-defg-hij`.

### 4. Obtener la transcripción

Cuando llegue `meeting.completed` (o consultando el estado):

```bash
curl -s https://<gateway-con-https>/transcripts/by-id/<id de la sesión> -H "X-API-Key: <clave>"
# → { segments: [{ speaker, text, … }], recordings: [{ id, playback_url: { audio } }] }

# Audio (dos pasos, como hace el CRM): la ruta de playback_url.audio devuelve { raw_url }, y raw_url es el archivo.
curl -s https://<gateway-con-https><playback_url.audio> -H "X-API-Key: <clave>"          # → { "raw_url": "…" }
curl -s -o grabacion.webm https://<gateway-con-https><raw_url> -H "X-API-Key: <clave>"    # → el audio
```

(El detalle de cada campo está en "Qué le devuelve Vexa al otro proyecto", más arriba.)

> **No verifiqué** que el cuerpo del webhook `meeting.completed` traiga el texto de la transcripción. Lo seguro es usarlo como **aviso** y pedir la transcripción con `GET /transcripts/by-id/{id}`, como hace el CRM (`vexa-bot-poll.ts`). Filtra frases inventadas por Whisper cuando hay silencio (ver `isLikelyWhisperHallucination` en ese archivo).

También hay `GET /transcripts/{platform}/{native_meeting_id}` y búsqueda en `GET /transcripts/search`.

Ejemplo para verificar la firma (Node):

```js
import crypto from "node:crypto";
export function verifyVexa(req, rawBody, secret) {
  const ts = req.headers["x-webhook-timestamp"];
  const sig = req.headers["x-webhook-signature"];
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // rechaza envíos viejos
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
```

(Usa el cuerpo **crudo** tal cual llegó, no el JSON ya reconvertido.)

### 5. Costos de transcripción

Vexa transcribe con la clave de OpenAI que tiene configurada **el servidor** (variables `TRANSCRIPTION_SERVICE_URL`/`TOKEN`): hoy son las de ProShop, así que **las reuniones del otro proyecto se transcribirían a tu cuenta de OpenAI**. Vexa permite que cada usuario configure la suya: `PUT /user/transcription` con su propia clave. Hazlo en el usuario del otro proyecto si no quieres absorber ese costo. (El CRM cobra a sus clientes la transcripción en créditos; el otro proyecto no pasa por ese cobro.)

## El peligro: los parches del CRM son globales

Los parches que viven en `vexa-patches/` se aplican **dentro del contenedor de Vexa y a todos los bots**, no solo a los del CRM:

| Parche | Qué hace | Efecto sobre las reuniones del otro proyecto |
|---|---|---|
| `apply-patch.js` (subtítulos de Meet + comandos `/bot` en el chat) | Manda los subtítulos y los comandos del chat a `chats.proshop.lat` con el token de la cuenta interna del CRM | **Los subtítulos de las reuniones del otro proyecto viajan al CRM.** |
| `apply-shots.js` (capturas) | Manda capturas de pantalla al CRM | Las capturas de sus reuniones llegan al CRM (el CRM las ignora: responde 202). |
| `apply-min-stay.js` | El bot no se va por "estoy solo" durante los primeros 30 min | **Los bots del otro proyecto también se quedan al menos 30 min** aunque la reunión termine. |

**Ya mitigado en el CRM (sin tocar Vexa):** desde el commit de este documento, cuando el asistente manda subtítulos de una reunión que el CRM **no** pidió, el CRM la **descarta** (responde 202) en lugar de guardarla como "Reunión Extensión" dentro de ProShop. Requiere redesplegar el CRM (no Vexa). Los comandos del chat (`/bot estado`) ya contestaban "no encuentro una reunión" sin guardar nada.

**Aun así, los datos salen del contenedor hacia el CRM antes de ser descartados.** Si el otro proyecto es de **otro cliente o contiene información sensible**, eso no es aceptable. La solución limpia (requiere **un reinicio de Vexa** en un momento sin reuniones, no un redespliegue) es hacer los parches "conscientes del usuario": que solo actúen cuando la sesión pertenezca al usuario del CRM. El parche ya recibe el id de la sesión (`inv.meeting_id`) y la invocación del bot; hay que agregarle el id del usuario dueño de la sesión y comparar con el del CRM (usuario 2). Propuesta de cambio en `vexa-patches/`:

1. En `apply-patch.js` y `apply-shots.js`, además de `__PROSHOP_SESSION_ID__`, leer el usuario de `inv` (verificar el nombre exacto del campo en `VEXA_BOT_CONFIG`) y no inyectar nada si no es el del CRM.
2. En `apply-min-stay.js`, aplicar la espera mínima solo a esas sesiones.
3. Subir la versión del parche (`INJECTED_VERSION`) para que se reemplace solo al reiniciar.

Mientras eso no se haga, usa el otro proyecto **solo si es tuyo y no maneja datos de terceros que no quieras que pasen por el CRM**, o espera al reinicio con los parches aislados.

## Lo que sí se comparte aunque no quieras

- **Capacidad:** CPU, memoria y el límite de 15 min de sala de espera son los mismos.
- **Disponibilidad:** si Vexa se reinicia (por ejemplo para aplicar parches), cae para los dos.
- **Versión de Vexa:** `v012`, construida el 14-sep-2026; hay versiones más nuevas (v0.12.28). Cualquier actualización afecta a ambos proyectos.
- **Anti-bot de Meet:** si Meet empieza a bloquear al asistente, bloquea a los dos.

## Alternativa si no quieres compartir

Levantar **otro Vexa independiente** (otro contenedor con su propia base y sus propios parches) para el otro proyecto. Cuesta más memoria (≈1 GB en reposo más cada bot), pero no comparte capacidad, ni parches, ni clave de transcripción. Es lo recomendable si ese proyecto es de un tercero.

## Lista de comprobación

- [ ] Gateway de Vexa con HTTPS (dominio propio) antes de dar claves a nadie.
- [ ] Usuario y clave propios del otro proyecto (`/admin/users` + `/tokens`) y `max_concurrent_bots` limitado.
- [ ] `PUT /user/webhook` con URL pública HTTPS, secreto largo y verificación de firma en su servidor.
- [ ] `PUT /user/transcription` con la clave de OpenAI del otro proyecto (o aceptar el costo).
- [ ] CRM redesplegado con el descarte de reuniones desconocidas.
- [ ] Decidir: parches aislados por usuario (un reinicio) **o** un Vexa aparte.
- [ ] Prueba con una reunión real: `POST /bots` → admitir al asistente → `meeting.completed` → `GET /transcripts/by-id/…`.
- [ ] Confirmar que las reuniones del otro proyecto **no** aparecen en el CRM (ni como "Reunión Extensión").

## Qué no pude verificar

- El cuerpo exacto de `meeting.completed` (si incluye la transcripción) y todos los campos de cada segmento de la transcripción (solo `speaker` y `text` están confirmados). Intenté revisarlo en el servidor el 7-nov-2026, pero el SSH no respondía; el comando de la sección "Comprobarlo con tus propios ojos" lo resuelve en 2 minutos.
- Las opciones adicionales de `POST /bots` y los campos exactos de `POST /admin/users` (la cabecera `X-Admin-API-Key` sí está confirmada; revisa `localhost:8001/docs` dentro del contenedor).
- Cuántos bots simultáneos aguanta el servidor: hay que medirlo.
