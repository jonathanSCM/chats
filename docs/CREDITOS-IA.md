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
| Transcripción de reunión (`transcripcion`) | 5 por minuto en la llamada |
| Cualquier función de IA nueva sin precio definido | 1 |

La transcripción se cobra una sola vez por reunión, al terminar bien el asistente. Si la reunión falla no se cobra.

## Qué cobra y qué no

- Las llamadas de IA que usan **la clave de la plataforma** gastan créditos. Con clave propia o personalizada de la organización **no** se cobran (el gasto no es de la plataforma).
- La transcripción gasta créditos siempre que la organización tenga plan de créditos (Vexa corre en la infraestructura de la plataforma).
- El costo real de la API se guarda en cada consumo (`AiCreditUsage.costUsd`) y solo lo ve el superadmin, para ajustar los precios con datos reales.

## Qué pasa al agotarse

| Uso | Qué ocurre |
|---|---|
| 80% | Aviso amarillo al dueño |
| 95% | Segundo aviso, pide recarga |
| 100% | Aviso rojo; se detienen las funciones de IA manuales; el asistente de reuniones no entra |
| Pasado el 100% | El **bot de WhatsApp** y la transcripción siguen con una reserva de emergencia de **300 créditos** antes del corte total |

El CRM nunca se detiene: contactos, pipeline, búsqueda, notas, tareas e historial siguen funcionando.

## Dónde se maneja

- **Superadmin** (`/admin/organizations/<id>` → Créditos de IA): fijar créditos por mes, recarga manual (con atajos de 2.000 / 5.000 / 10.000), anular un paquete cargado por error, ver consumo por función, usuario y operación con costo real.
- **Dueño** (`/dashboard/organization` → General → Créditos de IA): saldo, barra de uso, paquetes, consumo del mes. Banner en todo el panel desde el 80%.

## Tablas

`ai_credit_packs` (recargas) y `ai_credit_usages` (cada consumo: organización, usuario, función, modelo, tokens, minutos de audio, costo real, créditos y de dónde salieron). Migración `20261031000000_ai_credits`, aditiva.
