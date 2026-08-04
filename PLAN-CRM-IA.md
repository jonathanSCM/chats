# Plan de implementación — Asesor de ventas con CRM + IA

Plan para aplicar el *Manual Completo — Asesor de Ventas por WhatsApp integrado con CRM y
OpenAI* sobre la base que ya existe en este repositorio (WhatsApp ProShop, en producción en
`chats.proshop.lat`).

---

## 1. Punto de partida: qué ya está hecho

El manual asume construir desde cero. No es nuestro caso — la **Fase 2 del manual (WhatsApp)
está prácticamente completa** y varias piezas de infraestructura ya existen.

| Requisito del manual | Estado | Dónde |
|---|---|---|
| Recepción de mensajes WhatsApp | ✅ | `src/app/api/webhooks/whatsapp/route.ts` |
| Idempotencia por `external_message_id` | ✅ | `Message.externalId` único + captura de P2002 |
| Validación de firma del webhook | ✅ | `isValidWebhookSignature` |
| Respuesta rápida HTTP 200 | ⚠️ parcial | responde 200, pero procesa **en línea** (ver §2.1) |
| Estados: enviado / entregado / leído / fallido | ✅ | `Message.status` + `parseStatusUpdates` |
| Media (audio, imagen, video, documentos) | ✅ | `lib/media-storage.ts` + S3 |
| Notas de voz salientes | ✅ | `lib/audio-transcode.ts` (ffmpeg) |
| Bandeja por contacto | ✅ | `dashboard/inbox` |
| Asignación de vendedor | ✅ | `Conversation.assignedToId` (auto al primer responder) |
| Historial completo | ✅ | `Message` |
| Roles (admin / vendedor) | ✅ | `UserRole` OWNER / MEMBER / SUPERADMIN |
| Notificaciones al vendedor | ✅ | Web Push + PWA (`services/push.ts`) |
| Seguridad: HTTPS, secretos, cifrado en reposo | ✅ | `lib/crypto.ts`, variables de entorno |
| Backups | ✅ documentado | `README.md` |
| **Etiquetas y estados de conversación** | ❌ | — |
| **Notas internas** | ❌ | — |
| **Transferencia entre vendedores** | ❌ | solo auto-asignación |
| **CRM (contactos, empresas, leads, oportunidades)** | ❌ | — |
| **Embudo de ventas** | ❌ | — |
| **Actividades / tareas / reuniones** | ❌ | — |
| **Análisis con IA** | ❌ | — |
| **Plantillas de WhatsApp** | ❌ | — |
| **Analítica comercial** | ❌ | — |
| **Auditoría** | ❌ | — |

### Deuda heredada del fork que estorba

Este proyecto nació como copia de una plataforma de bots SaaS. Quedaron piezas que **entran en
conflicto directo con el manual**:

- **`src/server/services/openai.ts`** — genera respuestas automáticas al cliente. El manual es
  explícito: *"El sistema no debe funcionar como un chatbot que sustituye al vendedor"* (§Resumen
  ejecutivo) y *"Requiere aprobación humana: mensajes comerciales personalizados"* (§28). Este
  archivo hay que **reemplazarlo**, no extenderlo.
- **`Plan`, `Subscription`, `UsageRecord`, `stripe`, `services/subscription.ts`** — facturación
  SaaS multi-cliente. ProShop es un solo negocio; esto es peso muerto que complica el esquema.
- **`CatalogItem`, `BotConfig`** — el catálogo se reaprovecha como *base de conocimiento* (§26),
  pero con otra forma. `BotConfig` (personalidad del bot) ya no aplica.
- **Modelo `Bot`** — en realidad representa "el número de WhatsApp conectado". El nombre confunde
  en un CRM. Renombrarlo es riesgoso a mitad de vuelo (toca `Conversation`, `WhatsAppConnection`,
  guards, rutas); **propuesta: dejarlo, documentar que `Bot` = canal**, y revisar al final.

---

## 2. Decisiones de arquitectura

### 2.1 Trabajo asíncrono: el punto crítico

El manual asume Redis + BullMQ (§4). **Nosotros lo quitamos a propósito** cuando este proyecto
dejó de tener bots — no había nada pesado que encolar. La IA lo cambia todo:

- El análisis debe correr **después de 5–15 min sin mensajes nuevos** (§5), no al vuelo.
- Necesita reintentos con espera progresiva (§36).
- Hay trabajos programados: recordatorios, reporte diario, coaching semanal (§14).
- Hoy el webhook procesa **en línea**: una llamada a OpenAI dentro del webhook haría que Meta
  agote su timeout y reintente, duplicando trabajo.

**Dos caminos:**

| | A — Cola en Postgres | B — Volver a Redis + BullMQ |
|---|---|---|
| Infra nueva | ninguna | Redis + contenedor worker |
| Trabajos diferidos | `runAfter timestamp` + índice | nativo |
| Reintentos | columna `attempts` | nativo |
| Operación | una tabla más | otro servicio que monitorear |
| Volumen que aguanta | miles/día de sobra | millones |

El propio manual estima **30 conversaciones relevantes al día** (§35). Eso son ~900 análisis al
mes. Postgres se ríe de ese volumen.

> **Recomendación: opción A.** Tabla `Job` + un endpoint `/api/cron/tick` protegido por token,
> invocado cada minuto por una *Scheduled Task* de Coolify. Sin infraestructura nueva, coherente
> con la simplificación que ya hicimos. Si algún día el volumen se dispara, migrar a BullMQ es
> mecánico porque la lógica de cada job queda aislada.

### 2.2 Dónde vive el código

Mismo repositorio, fases incrementales, cada una desplegable. **No** una rama larga: este
proyecto ya está en producción atendiendo clientes reales, y una rama de meses garantiza
conflictos. Las funciones de IA quedan detrás de un interruptor (`AI_ENABLED`) para poder
desplegar sin activarlas.

### 2.3 Contrato con OpenAI

- **Responses API con Structured Outputs** y esquema estricto (§21, §22). Nada de texto libre
  para actualizar el CRM.
- **Modelos configurables por variable de entorno** (§20), nunca escritos en el código:
  `OPENAI_MODEL_FAST`, `OPENAI_MODEL_ANALYSIS`, `OPENAI_MODEL_EXECUTIVE`.
- **Validación con Zod del JSON devuelto antes de tocar la base** (§22). Si no valida: una
  corrección, y si vuelve a fallar se guarda como no procesado (§36).
- **Registro de tokens y costo por análisis** en `AiAnalysis`, con tope diario configurable que
  desactiva el análisis automático al superarse (§34).
- **`status: confirmed | inferred | unknown` por campo** (§8). Lo inferido **nunca** sobrescribe
  el CRM solo: se le muestra al vendedor para que confirme.

### 2.4 Autonomía (§27, §28)

| Sin aprobación | Con aprobación del vendedor | Nunca automático |
|---|---|---|
| Etiquetas, resúmenes, extracción de datos, tareas internas, alertas, reportes | Mensajes al cliente, cambios de etapa importantes, propuestas, descuentos | Contratos, condiciones legales, promesas de resultados, borrado de datos |

La IA **propone**; el backend valida y el vendedor decide. Las funciones (`create_task`,
`update_lead`, …) se validan siempre en servidor: que exista el lead, que el usuario tenga
permiso, que la fecha sea válida, que no duplique (§23).

---

## 3. Fases

Cada fase termina en algo desplegable y útil por sí solo.

### Fase 0 — Cimientos (sin funcionalidad visible)

1. ✅ Limpieza de la deuda del fork.
2. ✅ Base de conocimiento editable desde el panel (adelantada de la Fase 3 porque la IA
   depende de ella).
3. Tabla `Job` + `/api/cron/tick` + Scheduled Task en Coolify.
4. Mover el procesamiento pesado del webhook a la cola (el webhook solo guarda y encola).
5. Tabla `AuditLog` (§38): quién cambió qué, qué tocó la IA, qué aprobó el vendedor.

### Fase 1 — CRM núcleo

Modelos: `Company`, `Contact`, `Lead`, `Opportunity`, `Activity`, `Meeting`.

- Migración de datos: cada `Conversation` existente genera/enlaza un `Contact` por teléfono
  (ya guardamos `customerName` del perfil de WhatsApp — buen punto de partida).
- Detección de duplicados por teléfono/correo (§14).
- Embudo de 11 etapas (§7) con criterios de entrada/salida.
- Vista de oportunidad y tablero de embudo.
- **Regla dura:** toda oportunidad activa debe tener próximo paso (§45).

### Fase 2 — Cerrar los huecos de la bandeja

Lo que falta de §2A, barato y de uso diario inmediato:
- Etiquetas y estado de conversación (abierta / cerrada / en pausa).
- Notas internas (no van a WhatsApp).
- Transferencia manual entre vendedores (hoy solo hay auto-asignación).
- Panel lateral en el chat con el contacto y la oportunidad vinculados.

### Fase 3 — IA a demanda (el corazón del MVP)

Sin automatismos todavía: **el vendedor aprieta un botón**. Así se valida la calidad de los
prompts sin gastar en análisis que nadie lee.

- `services/ai/` nuevo (reemplaza `openai.ts`), con `AiAnalysis` y control de costos.
- Botones de §13: *Analizar conversación*, *Sugerir respuesta*, *¿Qué debo preguntar?*,
  *Evaluar mi conversación*.
- Salida estructurada de §22: resumen, score 0–100 con desglose de las 5 dimensiones (§9),
  objeciones, información faltante, próximo paso, respuesta sugerida.
- La respuesta sugerida entra al compositor **como borrador editable**, nunca se envía sola.

**Criterio de aceptación:** la IA devuelve JSON válido, no inventa presupuesto, no altera
nombres, y el costo por conversación es medible (§41).

### Fase 4 — Automatización y seguimiento

- Análisis automático con *debounce* de 5–15 min sin mensajes (§5).
- Tareas automáticas cuando se detecta un compromiso (§14).
- Recordatorios: seguimientos vencidos, leads calientes sin atención, propuestas sin
  seguimiento, reuniones sin confirmar.
- Notificaciones al vendedor con reglas de prioridad y **tope diario** (§16: máx. 5 alertas
  individuales + resumen al inicio y al cierre del día). Ya tenemos Web Push; falta el motor de
  reglas y el agrupamiento.
- **Plantillas de WhatsApp** (§17, §18) para escribirle al cliente fuera de la ventana de 24 h.
  Requiere aprobación previa en Meta.
- Reporte diario del vendedor (§29).

### Fase 5 — Coaching

- Evaluación 1–5 por conversación en las 10 habilidades de §11.
- Perfil acumulado por vendedor (§12).
- Plan semanal de máximo 3 acciones concretas.

### Fase 6 — Analítica

- Métricas de §31: actividad, velocidad, conversión, calidad, negocio.
- Reporte semanal del gerente (§30).

---

## 4. Modelo de datos (esbozo Prisma)

Adaptado al esquema actual — no es copia literal del manual, porque ya tenemos `User`,
`Conversation` y `Message` con otra forma.

```prisma
model Company { id, legalName, commercialName, industry, size, website, city, country, notes }

model Contact {
  id, fullName, phone @unique, email, jobTitle, city, country, source
  companyId, assignedUserId
  firstContactAt, lastContactAt
  conversations Conversation[]   // ← enlaza con lo que ya existe
}

model Lead {
  id, contactId, assignedUserId
  status, qualification, source, interest
  budgetRange, urgency, authorityLevel, needSummary
  nextAction, nextActionAt, leadScore
}

model Opportunity {
  id, leadId, title, stage, estimatedValue, currency, probability
  expectedCloseDate, serviceInterest, proposalSentAt
  wonAt, lostAt, lostReason
}

model Activity { id, leadId, opportunityId, assignedUserId, type, title, description, dueAt, completedAt, status, source }
model Meeting  { id, leadId, opportunityId, scheduledAt, durationMinutes, meetingUrl, location, status, notes, aiSummary }

model AiAnalysis {
  id, entityType, entityId, analysisType
  model, promptVersion, inputTokens, outputTokens, costEstimate
  resultJson, createdAt
}

model CoachingFeedback { id, userId, conversationId, category, score, feedback, recommendedAction, acknowledgedAt }
model NotificationRule { id, name, trigger, conditionsJson, recipientsJson, channel, templateName, active }
model AuditLog         { id, userId, entityType, entityId, action, beforeJson, afterJson, source, createdAt }
model Job              { id, type, payloadJson, runAfter, attempts, lastError, status, uniqueKey @unique }
```

Cambios sobre lo existente:
- `Conversation` gana `contactId`, `status`, `tags`, `aiSummary`, `aiAnalysisVersion`.
- `Message` ya tiene `externalId`, `status`, `sentById` — no necesita cambios.
- Claves de idempotencia según §37: `ai_analysis:{conversationId}:{lastMessageId}:{promptVersion}`.

---

## 5. Decisiones tomadas

1. **Privacidad (§33).** Se deja para el final, junto con la actualización de `/privacy`.
   ⚠️ Pendiente: no se puede lanzar el análisis en producción con clientes reales sin cerrar
   esto.
2. **Limpieza del fork.** ✅ Hecha. Fuera Stripe, `Plan`, `Subscription`, `UsageRecord`,
   `BotConfig`, `CatalogItem` y `openai.ts`. El panel `/admin` pasó de tablero SaaS (MRR,
   planes, uso) a métricas del negocio.
3. **Base de conocimiento (§26).** ✅ Hecha, editable desde `/dashboard/knowledge` por el
   administrador, con versión y responsable por entrada. Falta cargarla con el material real
   de ProShop — sin eso la IA recomienda a ciegas.
4. **Presupuesto de IA.** USD 5–20/mes, como sugiere el manual (§35). Se implementa como tope
   con corte automático en la Fase 3.
5. **Embudo.** Las 11 etapas de §7 tal cual.

---

## 6. Riesgos

- **Alcance.** El manual son 50 secciones y 6 fases; es un producto completo, no una
  funcionalidad. Intentar todo de una vez es la forma más segura de no terminar nada. Por eso
  cada fase se despliega sola.
- **Calidad de los prompts.** Es el trabajo real y no se resuelve escribiendo código: hay que
  iterar con conversaciones reales. Por eso la Fase 3 es manual (por botón) — barata de corregir.
- **Adopción.** Si los vendedores no confirman los datos inferidos, el CRM se llena de basura y
  la analítica miente. §47 lo pone como indicador de éxito.
- **Costo descontrolado.** Mitigado con tope diario + análisis por bloques, nunca por mensaje.
- **Regresión en producción.** `chats.proshop.lat` ya atiende clientes. Todo detrás de
  `AI_ENABLED`, y las migraciones siempre aditivas.
