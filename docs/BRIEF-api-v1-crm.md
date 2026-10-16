# Brief: API de integración v1 + eventos salientes en el CRM

> Para ejecutar en **una sesión aparte, dentro del repo del CRM** (`D:\Trabajo\ZocaloInbox`, GitHub `jonathanSCM/chats`, producción `https://chats.proshop.lat`).
> Lo consume el proyecto **Jefe de Operaciones** (`D:\Trabajo\JefeDeOperaciones`), que ya tiene implementado su lado.
> Contrato fuente de verdad: [`docs/openapi/integrations-v1.yaml`](./openapi/integrations-v1.yaml) (validado). **Si algo de este brief contradice al YAML, gana el YAML** y se avisa.
> Idioma de producto, UI, commits y mensajes de error visibles: **español**.

---

## 0. Reglas de trabajo (leer primero)

1. **Leer `AGENTS.md` y `node_modules/next/dist/docs/` antes de escribir código.** Next.js 16: `params` y `searchParams` son Promises; el middleware se llama `proxy` (`src/proxy.ts`).
2. **No correr `npm run build` en local.** Sí: `npx tsc --noEmit`, `npm test` y `eslint` de los archivos tocados.
3. **Migraciones SQL escritas a mano** en `prisma/migrations/<YYYYMMDDHHMMSS>_<nombre>/migration.sql` (Prisma 7). Se aplican solas al desplegar. Probar solo contra la base **local**, nunca contra producción.
4. **Nunca guardar ni imprimir secretos.** La `IntegrationKey` se muestra **una sola vez** al crearla; en base solo vive su hash.
5. **Nunca exponer** tokens cifrados de la organización (`metaAdsAccessToken`, tokens de Google, `meetExtensionToken`, etc.) en ninguna respuesta ni evento.
6. **Multiempresa estricto:** toda consulta se filtra por el `organizationId` de la clave. Un id de otra organización responde 404 (no 403, para no revelar existencia).
7. Hacerlo en **PRs/commits pequeños en el orden de la sección 9**; cada uno con tests y verde en `tsc` + `npm test`.
8. No tocar el comportamiento existente (bandeja, bots, reuniones). Todo lo nuevo es aditivo.
9. Preguntar al dueño ante cualquier decisión de la sección 11 que no esté resuelta por el default indicado.

---

## 0 bis. Correcciones de la revisión (16/10/2026) — **respetar sobre el resto del documento**

Revisado contra el código real del CRM. Si algo de abajo contradice esta sección, gana esta sección.

**Antes de empezar**
- Copiar al repo del CRM `docs/openapi/integrations-v1.yaml` (v1.0.1-draft) y este brief a `docs/`: el CRM **no tiene carpeta `docs/`** hoy y el YAML vive en el repo del Jefe.
- El YAML se actualizó a **1.0.1**: agrega `ping`, `aiSummaryData`/`aiSummaryAt`/`updatedAt` en Meeting, `GET /activities`, `updatedSince` en contactos y respuestas 403/409/429.

**Lo que no coincidía con el CRM**
1. `opportunity.stage_changed` no sale de `pipeline.ts`: sale de `updateOpportunityFieldAction` y de `pipeline-stages.ts` (ver 6.2).
2. Faltan **índices** que la API necesita: `Message(conversationId, createdAt)`, `Conversation(botId, lastMessageAt)`, `Meeting(organizationId, updatedAt)`. Van en la misma migración.
3. `GET /meetings` puede ser enorme (transcripciones de hasta 500.000 caracteres): tope práctico de 25 por página.
4. `meeting.transcript_ready` no debe colgarse del barrido de resúmenes (necesita marca propia, ver 6.2).
5. No emitir `message.created` para historial importado (Coexistence).
6. El prefijo visible de la clave no puede ser "los primeros 8 caracteres" (son `pk_live_`).
7. La idempotencia debe comparar también método y ruta.
8. Las tareas necesitan una vista mínima en la ficha del caso (entrega obligatoria).

**Seguridad adicional**
- SSRF: además de validar la URL al guardarla, **resolver el nombre y revisar la IP en cada envío** (anti DNS-rebinding), sin seguir redirects.
- **Privacidad:** la API entrega mensajes y teléfonos; prever un filtro por número de WhatsApp (`excludedBotIds` por clave u organización) para poder excluir canales sensibles, en línea con los principios del Jefe. Mínimo: permitir `?botId=` en `/conversations` y registrar la decisión.
- Alcance `write:activities`: también escribe la próxima acción de un caso; documentarlo (o renombrarlo a `write:tasks`).
- Registrar los eventos de claves y webhooks en `audit()` **y agregar sus tipos de entidad a `ADMIN_ENTITY_TYPES` de `src/app/admin/logs/page.tsx`**, o no se verán en el Registro del superadmin.
- El endpoint existente `/api/media/[fileName]` solo valida sesión, no organización; no copiar ese patrón: el endpoint nuevo debe resolver el mensaje y verificar `organizationId`.

**Del lado del Jefe (ya aplicado el 16/10)**: el receptor acepta cuerpos de hasta 5 MB, responde `{ok:true,pong:true}` a `ping` (firmado, sin tocar la base), y tolera `title: null`. El cliente de API tolera reuniones sin título.

---


## 1. Contexto y objetivo

El Jefe de Operaciones convierte conversaciones y reuniones en compromisos aprobados por una persona y los devuelve al CRM como **tareas**. Hoy lee el CRM por SQL de solo lectura (puente temporal). Objetivo: reemplazarlo por una **API versionada con clave por organización**, y que el CRM **avise por webhook** cuando hay datos nuevos.

Qué ya está hecho en el lado del Jefe (no reimplementar, solo respetar el contrato):

| Pieza del Jefe | Qué espera del CRM |
|---|---|
| `ApiCrmClient` (`src/server/crm/api-client.ts`) | `GET /me`, `/users`, `/meetings`, `/conversations`, `/conversations/{id}/messages`; paginación `{data, nextCursor}`; `Idempotency-Key` en POST; reintenta 429/5xx respetando `Retry-After` |
| `POST /webhooks/crm` (`src/server/webhooks/crm.ts`) | Cabecera `X-ProShop-Signature: t=<unix>,v1=<hex>`; HMAC-SHA256 de `"<t>.<cuerpo crudo>"`; ventana ±300 s; dedupe por `eventId`; acepta varios `v1=` (rotación) |
| Procesador de eventos (`src/server/webhooks/process.ts`) | Para `meeting.transcript_ready` espera `data` con `meetingId, title, scheduledAt, transcript?, audioTranscript?, notes?, opportunityId?` |
| Sync de tareas (`src/server/crm/sync.ts`) | `POST /activities` con `Idempotency-Key: commitment:<id>`; `POST /opportunities/{id}/next-action` con `commitment:<id>:next-action` |

---

## 2. Hallazgos del CRM verificados (15/10/2026, solo lectura del repo)

- **`Activity` existe y nadie la crea** (`prisma/schema.prisma` ~L953; mapeada a `activities`; `source` default `"user"`, el Jefe usará `"ai"`). Solo hay `completeActivityAction` (`src/server/actions/crm.ts`). La API será el primer productor.
- **El CRM YA genera resumen de reuniones con IA** (commit `ea63dec` "F7", migración `20261015120000_meeting_ai_summary`): `Meeting.aiSummary`, `aiSummaryData` (Json estructurado: resumen, puntos, decisiones, próximos pasos, información comercial), `aiSummaryAt`, `aiSummaryAppliedAt`; job `meeting_summary` encolado desde `src/app/api/cron/tick/route.ts` tras `MEETING_SETTLE_MINUTES = 10`. **El plan original decía que `aiSummary` estaba vacío: ya no aplica.** Consecuencia: exponer `aiSummary` y `aiSummaryData` en la API y emitir `meeting.summary_ready`; el Jefe podrá reutilizarlo en vez de pagar un segundo resumen (cambio posterior del lado del Jefe).
- **Cola de jobs** (`src/server/jobs/`): `enqueue({type, payload, uniqueKey, runAfter, maxAttempts})` idempotente por `uniqueKey` (P2002 se ignora); handlers registrados en `handlers` de `src/server/jobs/index.ts`; `onExhausted` para dejar rastro; se procesa tras webhooks y cada minuto vía `/api/cron/tick`. **Es el outbox.**
- **Patrón de endpoint con secreto:** `src/app/api/cron/tick/route.ts` (`timingSafeEqual`). **Auditoría:** `audit()` en `src/server/services/audit.ts` (nunca lanza).
- **Pestaña "Integraciones"** ya existe en `src/app/dashboard/organization/page.tsx` (tabs `general | ventas | integraciones | equipo`). Acá va la administración de claves y del webhook.
- Roles: `OWNER` se muestra como "Admin", `MEMBER` como "Vendedor". Solo `OWNER` administra integraciones.
- Datos relevantes (nombres reales): `Message.content` (texto), `Message.role` (`CUSTOMER|BOT|STAFF|SYSTEM`), `Message.mediaType`, `isVoiceNote`, `fileName`; `Conversation.customerName/customerPhone/status/assignedToId/contactId/lastMessageAt`; `Meeting.title` (nullable si es suelta), `scheduledAt`, `status`, `transcript`, `audioTranscript`, `notes`, `opportunityId`, `updatedAt`; `Opportunity.nextAction/nextActionAt/assignedToId/stageId`.

---

## 3. Modelo de datos nuevo (una migración SQL a mano)

### 3.1 `IntegrationKey`
| Campo | Tipo | Nota |
|---|---|---|
| `id` | cuid | |
| `organizationId` | FK Organization, cascade | |
| `name` | string | "Jefe de Operaciones" |
| `prefix` | string | los **6 caracteres siguientes a `pk_live_`** (los primeros 8 son siempre `pk_live_`: no identifican nada) |
| `keyHash` | string **unique** | SHA-256 hex de la clave completa |
| `scopes` | string[] | `read`, `write:activities` |
| `createdById` | FK User | |
| `lastUsedAt` | timestamp? | actualizar como mucho 1 vez por minuto |
| `revokedAt` | timestamp? | |
| `createdAt` | timestamp | |

Formato de la clave: `pk_live_` + 32 bytes aleatorios en base64url (≈43 chars). Generar con `crypto.randomBytes`. Hash con SHA-256 (alta entropía, no hace falta bcrypt). Búsqueda por `keyHash` (unique) y comparación `timingSafeEqual`.

### 3.2 `IntegrationWebhook` (destino de eventos)
`id, organizationId, url (https obligatorio fuera de localhost), secretEncrypted, events String[] (vacío = todos), enabled, lastSuccessAt, lastFailureAt, lastError, createdAt`. El secreto se guarda **cifrado con el mismo helper que ya usa el CRM para tokens** (buscarlo por `metaAdsAccessToken`); se muestra una sola vez y se puede rotar.

### 3.3 `IdempotencyRecord`
`id, organizationId, keyId, idempotencyKey, method, path, requestHash (sha256 del body canónico), responseStatus, responseBody (Json), createdAt`; **unique `(organizationId, idempotencyKey)`**; limpiar >7 días (agregar al cron tick existente o a un job `cleanup_idempotency`). **Al reutilizar una clave, comparar también `method` y `path` además de `requestHash`: si no coinciden → `409 idempotency_key_reuse`** (si no, la misma clave usada en otra ruta devolvería la respuesta de la primera).

### 3.4 `ActivityLink` (opcional pero recomendado)
Para devolver `Activity` completa no hace falta. No crear nada extra salvo que la tabla `activities` no soporte lo necesario. Ver 11.4.

---

## 4. Autenticación: `requireIntegrationKey(scope)`

Archivo sugerido: `src/server/integrations/auth.ts`.

1. Leer `Authorization: Bearer <clave>`; ausente/mal formada → `401 {error, code:"unauthorized"}`.
2. SHA-256 → buscar `IntegrationKey` por `keyHash`; no existe o `revokedAt` → 401 (mismo mensaje, mismo tiempo aproximado).
3. Verificar que la organización no esté `suspended` → `403 code:"organization_suspended"`.
4. Verificar `scope` → `403 code:"insufficient_scope"`.
5. Devolver `{ organizationId, keyId, scopes }`; actualizar `lastUsedAt` (throttled) sin bloquear la respuesta.
6. **Rate limit** por clave: 120 req/min lectura, 30 req/min escritura → `429` con `Retry-After`. En memoria alcanza para un solo contenedor; dejar nota si se escala.
7. Todas las respuestas de error: `{ "error": "<mensaje en español>", "code": "<slug>" }` con `Cache-Control: no-store`.

Registrar en `audit()`: creación, revocación y rotación de claves (actor `USER`), y cada **escritura** hecha vía API (actor `SYSTEM`, `entityType` `activity`/`opportunity`, `action` `integration_create`/`integration_next_action`).

---

## 5. Endpoints (ruta base `/api/integrations/v1`)

Seguir **exactamente** `docs/openapi/integrations-v1.yaml`. Resumen de mapeo y reglas:

| Método y ruta | Scope | Fuente en el CRM | Reglas |
|---|---|---|---|
| `GET /me` | read | `Organization` + clave | `{organizationId, name, timezone, scopes}` |
| `GET /users` | read | `OrganizationMembership` + `User` | solo `OWNER`/`MEMBER` (excluir `SYSTEM`/`SUPERADMIN`); sin tokens; `id` = `User.id` |
| `GET /conversations?since&cursor&limit` | read | `Conversation` (vía `Bot.organizationId`) | filtro `lastMessageAt > since`; orden `lastMessageAt asc, id asc` |
| `GET /conversations/{id}/messages?after&cursor&limit` | read | `Message` | `createdAt > after`; `text` = `content`; media pura → `text: null` y `mediaType` informado; **no** devolver `mediaUrl` interna |
| `GET /messages/{id}/media` | read | archivo local de `/api/media/[fileName]` | stream con `Content-Type`; 404 si no es de la organización o no descargado |
| `GET /meetings?since&cursor&limit` | read | `Meeting` | filtro por **`updatedAt > since`**; incluir `transcript`, `audioTranscript`, `notes`, `aiSummary`, `aiSummaryData`, `aiSummaryAt`; `attendees` desde `guestEmails` (opcional) | **Tamaño:** cada transcripción admite hasta 500.000 caracteres; con `limit=200` la respuesta podría pasar los 100 MB. Fijar un **tope práctico de 25 reuniones por página** (o un presupuesto de bytes por página) y devolver `nextCursor` aunque haya menos filas que `limit`. Mapear `title` nulo → `"Reunión"`.
| `GET /meetings/{id}/attachments` | read | `MeetingAttachment` | `downloadUrl` firmada de corta duración (ver 11.3) |
| `GET /contacts` | read | `Contact` (+`Company.name`) | paginado |
| `GET /opportunities?updatedSince` y `/{id}` | read | `Opportunity` + `PipelineStage.label` | `stageLabel`, `nextAction`, `nextActionAt`, `assignedToId` |
| `GET /knowledge` | read | `KnowledgeItem` donde `active` | |
| `POST /activities` | write:activities | crea `Activity` | ver 5.1 |
| `PATCH /activities/{id}` | write:activities | actualiza `Activity` | `status` (`DONE` setea `completedAt`), `dueAt`, `assignedToId`; solo actividades de la organización |
| `POST /opportunities/{id}/next-action` | write:activities | actualiza `nextAction/nextActionAt/assignedToId` | idempotente; respetar la misma lógica/validaciones que la acción de UI existente (buscarla y reutilizar el servicio, no duplicar) |
| `POST /events/ack` | read | opcional | 204 |

**Paginación por cursor:** cursor opaco = base64url de `{t: <timestamp de orden>, id}`; `nextCursor: null` al final; `limit` 1–200 (default 50). Orden estable `(campoDeOrden asc, id asc)`. Pensado para que el cliente use `since` + cursor sin saltar ni duplicar filas con el mismo timestamp.

### 5.1 `POST /activities`
- Validar con Zod (Zod 4 en el CRM): `type ∈ ActivityType`, `title` 1–300, `description` ≤ 5000, `dueAt` ISO con offset, `assignedToId` debe ser **miembro de la organización** (si no → `422 code:"validation_error"`), `opportunityId`/`contactId` deben pertenecer a la organización (si no → 422).
- `source` se fuerza a `"ai"` cuando la clave es de integración (ignorar `"user"`).
- **Idempotencia** (cabecera `Idempotency-Key` obligatoria, 8–128 chars):
  - Primera vez: crea y responde `201` con la `Activity`; guardar `IdempotencyRecord`.
  - Misma clave + **mismo body** (`requestHash`): responde `200` con la **misma** respuesta almacenada, sin crear nada.
  - Misma clave + **body distinto, o distinto método/ruta**: `409 code:"idempotency_key_reuse"`.
  - Hacerlo en una transacción; carrera entre dos requests idénticos resuelta por el unique `(organizationId, idempotencyKey)` (el perdedor relee y devuelve el registro ganador).
- Emitir evento `activity.created`.

### 5.2 Forma de las respuestas
Usar exactamente los esquemas del YAML (`Page`, `Meeting`, `Message`, `Activity`, …). Fechas en ISO 8601 UTC con `Z`. Campos opcionales ausentes → `null`, no omitidos. No agregar campos no documentados sin actualizar el YAML.

---

## 6. Webhooks salientes (outbox sobre la cola existente)

### 6.1 Diseño
1. Servicio `emitIntegrationEvent({organizationId, type, entityId, data, discriminator?})` en `src/server/integrations/events.ts`:
   - Construye `eventId` **determinístico** (ver 6.3).
   - Por cada `IntegrationWebhook` habilitado de la organización cuyo `events` incluya el tipo: `enqueue({ type: "integration_webhook_delivery", payload: {webhookId, event}, uniqueKey: "jefe-evt-<webhookId>-<eventId>", maxAttempts: 8 })`.
   - **Nunca lanza** ni bloquea la operación de origen (try/catch + log), igual que `audit()`.
2. Handler `handleIntegrationWebhookDelivery` registrado en `handlers` de `src/server/jobs/index.ts`:
   - Serializa el evento **una sola vez**; firma `HMAC-SHA256(secret, "<t>.<body>")`, cabecera `X-ProShop-Signature: t=<unix>,v1=<hex>`, `Content-Type: application/json`, `User-Agent: ProShopCRM-Webhooks/1`.
   - `fetch` con timeout 10 s. **2xx = entregado.** Errores **transitorios** (5xx, 408, 429, red, timeout) → lanzar para que la cola reintente con su backoff. Errores **permanentes** (400, 401, 404, 413, 422) → **no reintentar**: marcar `lastFailureAt/lastError` y dejar el evento como fallido visible en la UI (reintentar 8 veces un 401 solo genera ruido). La UI debe ofrecer "reenviar" para esos casos.
   - Re-firmar con un `t` nuevo en cada intento (si no, el anti-replay del receptor rechazaría reintentos viejos). El `eventId` no cambia.
   - Actualizar `lastSuccessAt` / `lastFailureAt` / `lastError` (truncado, **sin** la URL con credenciales ni el secreto).
   - `onExhausted`: dejar `lastError` visible en la pestaña Integraciones.
3. Seguridad de la URL destino: solo `https`; rechazar IPs privadas/loopback/link-local y `localhost` **en producción** (protección SSRF). En desarrollo permitir `http://localhost`. No seguir redirects (`redirect: "manual"`).

### 6.2 Cuándo emitir (puntos de enganche)
| Evento | Dónde emitirlo | Payload `data` |
|---|---|---|
| `message.created` | tras guardar un mensaje **nuevo** en `handleIncomingMessage` (y eco de app, `handlePhoneAppEcho`) en `src/server/services/conversation.ts`. **No emitir** para mensajes históricos (`isHistorical`) ni los que importa `handleHistoryImport` al conectar Coexistence (serían miles de eventos de golpe), ni para duplicados (`externalId` ya existente). | `{conversationId, messageId, role, mediaType, text, contact:{id,name,phone}, opportunityId, assignedToId}` |
| `meeting.transcript_ready` | **No colgarlo del barrido de resúmenes** (ese barrido selecciona `aiSummaryAt: null`, corre cada minuto y, si la IA está apagada o falla, nunca termina). Agregar a `Meeting` una marca propia (p. ej. `integrationTextHash`) y un barrido aparte en `/api/cron/tick`: reuniones con texto cuyo `updatedAt` tenga > 10 min y cuyo hash del texto concatenado difiera del último emitido → emitir y guardar el hash. | **`{meetingId, title, scheduledAt, transcript, audioTranscript, notes, opportunityId}`** (el Jefe lo valida con ese esquema; `title` nunca null: usar `"Reunión"` si falta). Pueden ser textos largos: el receptor del Jefe acepta hasta 5 MB; si el evento pasa de ~4 MB, enviar solo `transcript` (o el más largo) y avisar con `truncated: true`. |
| `meeting.summary_ready` | al terminar `handleMeetingSummary` (`src/server/services/meeting-summary.ts`) | `{meetingId, aiSummary, aiSummaryData, aiSummaryAt}` |
| `opportunity.stage_changed` | en `updateOpportunityFieldAction` (`src/server/actions/crm.ts`, ~L311; ahí se audita `stage_change`) **y** en `src/server/actions/pipeline-stages.ts` (~L165, reasignación en masa con `updateMany` al borrar una etapa). `src/server/services/pipeline.ts` solo tiene ayudantes, no cambia etapas. | `{opportunityId, fromStageLabel, toStageLabel}` |
| `opportunity.next_action_changed` | donde se escribe `nextAction*` | `{opportunityId, nextAction, nextActionAt, assignedToId}` |
| `conversation.assigned` | al cambiar `assignedToId` | `{conversationId, assignedToId}` |
| `activity.created` / `activity.completed` | en el endpoint nuevo y en `completeActivityAction` | `{activityId, ...campos}` |
| `document.received` | cuando un mensaje con `mediaType = DOCUMENT` termina de descargarse (`download_media`) | `{messageId, conversationId, fileName, mimeType}` |

Prioridad de implementación: **`meeting.transcript_ready`, `meeting.summary_ready`, `message.created`**. El resto puede quedar para una segunda pasada (marcar claramente qué falta).

### 6.3 `eventId` determinístico
- `message.created` → `msg_<messageId>`
- `meeting.transcript_ready` → `mtr_<meetingId>_<sha1(texto concatenado).slice(0,12)>` (si la transcripción se edita se re-emite; si no cambia, no duplica)
- `meeting.summary_ready` → `msr_<meetingId>_<aiSummaryAt en ms>`
- `activity.created` → `act_<activityId>`; `activity.completed` → `actdone_<activityId>`
- resto → `<tipo>_<entityId>_<versión>`
Máximo 200 chars. Es el valor que el Jefe usa para deduplicar.

### 6.4 Envoltorio
```json
{
  "eventId": "msg_cmq0x...",
  "type": "message.created",
  "organizationId": "cm...",
  "occurredAt": "2026-10-15T14:03:11Z",
  "data": { }
}
```
`organizationId` es el id de la organización **del CRM** (el Jefe lo usa para resolver su tenant).

---

## 7. UI de administración (pestaña Integraciones, solo `OWNER`)

En `src/app/dashboard/organization/page.tsx` (tab `integraciones`), componente nuevo y acciones de servidor con el mismo chequeo de rol `OWNER` que ya usan las demás acciones de esa página (buscarlo y reutilizarlo):

1. **Claves de API:** tabla (nombre, prefijo, scopes, último uso, estado) · botón "Crear clave" (nombre + scopes) que muestra la clave **una sola vez** con aviso de copiarla · botón "Revocar" con confirmación.
2. **Webhook de eventos:** URL, eventos suscriptos (checkboxes), botón "Generar/rotar secreto" (se muestra una vez), "Enviar evento de prueba" (`type: "ping"` firmado) y estado de la última entrega (éxito/fallo/error).
3. Textos en español, mismo estilo visual que el resto de la pestaña (ver `DESIGN.md`). No introducir librerías nuevas.

---

## 8. Pruebas requeridas (vitest, ya configurado en el CRM)

Guard/clave: sin cabecera, clave inexistente, revocada, org suspendida, scope insuficiente, `lastUsedAt` throttled, rate limit con `Retry-After`.
Aislamiento: con dos organizaciones, **ningún** endpoint devuelve ni modifica datos de la otra (test por endpoint, incluyendo ids ajenos → 404).
Paginación: cursor estable con timestamps repetidos; `limit` máximo; sin duplicados ni saltos al encadenar páginas.
`POST /activities`: crea (201); misma clave+body → 200 mismo `id` sin crear otra fila; misma clave+body distinto → 409; `assignedToId` ajeno → 422; `source` forzado a `ai`; carrera de dos requests simultáneos → una sola fila.
`PATCH /activities`: `DONE` setea `completedAt`; actividad ajena → 404.
`next-action`: aplica y emite evento; idempotente.
Outbox: `emitIntegrationEvent` encola 1 job por webhook/evento y es idempotente por `uniqueKey`; firma verificable con la **misma función** que usa el Jefe (copiar `verifySignature` del Jefe a un test de contrato); reintento re-firma con `t` nuevo; 4xx/5xx/timeout → lanza; 2xx → marca éxito; URL privada rechazada en producción; no sigue redirects.
Serializadores: **test que falle si aparece un campo con token/secreto** (lista negra por nombre) en cualquier respuesta.
Contrato: validar las respuestas de ejemplo contra los esquemas del YAML (por ejemplo con un parser de OpenAPI en test, o esquemas Zod espejo).

---

## 9. Orden de entrega sugerido (cada paso con tests y verde)

1. **Migración + modelos** (`IntegrationKey`, `IntegrationWebhook`, `IdempotencyRecord`) y generación del cliente Prisma.
2. **Guard + generación/revocación de claves** (servicio + acciones + UI mínima de claves).
3. **Endpoints de lectura** (`/me`, `/users`, `/meetings`, `/conversations`, `/conversations/{id}/messages`, resto) con paginación y aislamiento.
4. **Escritura**: `POST/PATCH /activities` con idempotencia + `next-action`, **más una vista mínima de tareas en la ficha del caso (lista + completar con `completeActivityAction`)**: hoy ningún componente muestra ni completa `Activity`, así que sin esto las tareas aprobadas por el Jefe son invisibles para el vendedor.
5. **Outbox + handler de entrega + UI de webhook + ping**.
6. **Emisión de eventos** en los puntos de la sección 6.2 (empezando por los tres prioritarios).
7. Limpieza programada de `IdempotencyRecord`, documentación breve en `README` del CRM y actualización del YAML si hubo desvíos.

---

## 10. Criterios de aceptación (de punta a punta)

1. Con una clave `read`, el `ApiCrmClient` del Jefe (apuntando a un entorno local del CRM) lista usuarios, reuniones y mensajes paginando sin duplicados.
2. `POST /activities` dos veces con la misma `Idempotency-Key` crea **una** tarea y la segunda respuesta es `200` con el mismo `id`.
3. Terminada una reunión, el Jefe recibe `meeting.transcript_ready` (firma válida, `eventId` estable) y crea el `SourceItem`; un reintento del mismo evento responde `duplicate` sin duplicar.
4. Revocar la clave corta el acceso de inmediato; ningún endpoint filtra datos de otra organización.
5. La pestaña Integraciones permite crear/revocar claves y configurar/probar el webhook; un fallo de entrega es visible.
6. `npx tsc --noEmit` y `npm test` en verde; `eslint` limpio en lo tocado; la migración SQL aplica sobre la base local desde cero.

---

## 11. Decisiones abiertas (default propuesto → confirmar con el dueño)

| # | Pregunta | Default |
|---|---|---|
| 11.1 | ¿La tarea del Jefe se escribe como `Activity`, como `nextAction` o ambas? | **`Activity` siempre**; `next-action` solo si la organización lo activa (el Jefe ya lo trae apagado por defecto). Verificado el 16/10: **ninguna pantalla lista ni completa `Activity`** (`completeActivityAction` no tiene ningún llamador en la interfaz). Por eso la vista mínima de tareas **es parte obligatoria de la entrega** (paso 4 de la sección 9), no algo a verificar. |
| 11.2 | ¿Una clave por organización o por integración? | Varias claves por organización, cada una con scopes. |
| 11.3 | Descarga de adjuntos/media | URL firmada con expiración de 10 min generada por el CRM (HMAC con secreto del servidor) o stream autenticado con la misma clave; elegir lo más simple con lo que ya sirve `/api/media/[fileName]`. |
| 11.4 | ¿Hace falta un vínculo `Activity ↔ compromiso del Jefe`? | No: el Jefe guarda `crmActivityId`. |
| 11.5 | Retención de `IdempotencyRecord` | 7 días. |
| 11.6 | ¿Exponer `Message` de rol `BOT`/`SYSTEM`? | Sí, con su `role`; el Jefe decide si los ignora. |
| 11.7 | Notas de voz de WhatsApp sin transcribir (`isVoiceNote`) | Fuera de alcance de este brief; exponer `mediaType: AUDIO` y `isVoiceNote`. Si ya existe transcripción en `content`, devolverla en `text`. |

---

## 12. Fuera de alcance

Cambios en la lógica de bots/IA del CRM; correo; Mattermost; escritura de mensajes de WhatsApp desde la API; webhooks entrantes nuevos; panel de métricas; cualquier cambio en el proyecto del Jefe (se hace allá).

---

## 13. Después de construirlo (del lado del Jefe)

1. Crear la clave en producción, cargar `CRM_API_URL` y `CRM_API_KEY` en el Jefe (`getCrmClient` ya prioriza la API sobre SQL) y `CRM_WEBHOOK_SECRET` con el secreto del webhook.
2. Apuntar el webhook del CRM a `https://<dominio-del-jefe>/webhooks/crm`.
3. Aprovechar `aiSummary`/`aiSummaryData` para no volver a resumir reuniones (ajuste pendiente en el pipeline del Jefe).
4. Retirar el acceso SQL de solo lectura.
