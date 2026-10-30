# Créditos de IA

Modelo comercial de CRM ProShop (basado en "Modelo de créditos IA de CRM ProShop"). Todo se activa y recarga a mano desde `/admin`: todavía no hay pasarela de pago.

## Reglas

- **1 crédito = hasta US$ 0,001** de presupuesto de IA. Es una unidad comercial, no el costo exacto de cada llamada.
- **Bolsa mensual** (`Organization.aiCreditsMonthly`): compartida por todos los usuarios; se renueva cada mes calendario (UTC) y **no se acumula**. Vacía = la organización no usa créditos y todo se comporta como antes.
- **Paquetes** (`AiCreditPack`): recargas que duran 90 días (editable al cargarlas). Se gasta **primero la bolsa mensual** y después el paquete que vence antes.
- **Suborganizaciones** gastan de la bolsa de su organización principal.
- Referencia de dimensionamiento: usuarios × 1.600 (5 usuarios = 8.000). Solo se muestra como sugerencia; el superadmin fija el número.
- Paquetes que se venden: 2.000 por S/ 25, 5.000 por S/ 50, 10.000 por S/ 90.

## Cuánto cuesta cada cosa (`src/lib/ai-credits.ts`, `FEATURE_CREDITS`)

| Función | Créditos |
|---|---|
| Respuesta y calificación del bot (`bot_calificacion`) | 2 |
| Análisis comercial de un seguimiento (`seguimiento`) | 3 |
| Editor de conocimiento (`knowledge_editor`) | 3 |
| Resumen de reunión con IA (`meeting_summary`) | 15 |
| Resumen en vivo de una reunión, `/bot resumen` (`meeting_summary_live`) | 3 |
| Transcripción de reunión (`transcripcion`) | **gratis** (se registran los minutos) |
| Cualquier función de IA nueva sin precio definido | 1 |

La transcripción no gasta créditos: corre en el servidor propio (no se paga por minuto a OpenAI). Al terminar bien una reunión se anota el uso con sus minutos y 0 créditos, una sola vez por reunión, para tener el dato. Lo que sí gasta es el resumen con IA.

## Qué cobra y qué no

- Las llamadas de IA que usan **la clave de la plataforma** gastan créditos. Con clave propia o personalizada de la organización **no** se cobran (el gasto no es de la plataforma).
- La transcripción y la grabación no gastan créditos (Vexa corre en la infraestructura de la plataforma).
- El costo real de la API se guarda en cada consumo (`AiCreditUsage.costUsd`) y solo lo ve el superadmin, para ajustar los precios con datos reales.

## Qué pasa al agotarse

| Uso | Qué ocurre |
|---|---|
| 80% | Aviso amarillo al dueño |
| 95% | Segundo aviso, pide recarga |
| 100% | Aviso rojo; se detienen las funciones de IA manuales; el asistente de reuniones no entra |
| Pasado el 100% | El **bot de WhatsApp** sigue con una reserva de emergencia de **300 créditos**; al agotarse también, la conversación pasa a una persona del equipo con un aviso (el bot ya no queda callado) |

El CRM nunca se detiene: contactos, pipeline, búsqueda, notas, tareas e historial siguen funcionando.

## Dónde se maneja

- **Superadmin** (`/admin/organizations/<id>` → Créditos de IA): fijar créditos por mes, recarga manual (con atajos de 2.000 / 5.000 / 10.000), anular un paquete cargado por error, ver consumo por función, usuario y operación con costo real.
- **Dueño** (`/dashboard/organization` → General → Créditos de IA): saldo, barra de uso, paquetes, consumo del mes. Banner en todo el panel desde el 80%.

## Tablas

`ai_credit_packs` (recargas) y `ai_credit_usages` (cada consumo: organización, usuario, función, modelo, tokens, minutos de audio, costo real, créditos y de dónde salieron). Migración `20261031000000_ai_credits`, aditiva.

## Qué se detiene sin créditos (y qué no)

Se detiene: el análisis del asesor, el editor de conocimiento, los resúmenes de reunión con IA (y su PDF) y las respuestas del bot. Siguen: chats, contactos, pipeline, calendario, reuniones, grabación y transcripción del asistente, notas, tareas e historial. Los mensajes que ve el usuario dicen que faltan créditos o que el plan venció (no el viejo "tope diario"). Los resúmenes automáticos que quedaron sin hacer se retoman solos cuando hay créditos o se renueva el plan.

## Período de la bolsa

La bolsa se renueva **cada mes el mismo día que empezó el plan** (`planStartedAt`), no el 1 de cada mes. Una organización sin plan con fechas usa el mes calendario (UTC) de siempre.

## Pedir más créditos

El dueño tiene en su panel (General → Créditos de IA) el botón **Solicitar más créditos** (paquetes de 2.000 / 5.000 / 10.000 o una cantidad libre, con mensaje opcional). Le llega al superadmin en `/admin/solicitudes` (contador en el menú). Al **aprobar** —después de recibir el pago por otro medio— se carga un paquete de 90 días en la organización dueña de la bolsa. Tope: 3 solicitudes pendientes por organización.
