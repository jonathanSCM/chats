# Asistente de reuniones (Meet): investigación y plan

Fecha: 3-nov-2026. Solo lectura: no se cambió código ni servidor.

## 1. Qué pasa hoy (datos reales de producción, últimos 30 días)

El asistente es **Vexa** (imagen `vexaai/vexa-lite:v012`, construida el 14-sep-2026, sin reinicios), llamado desde el CRM con `meeting_bot_join` y `vexa_bot_poll`.

| Resultado en Vexa | Sesiones |
|---|---|
| Completadas (grabó y transcribió) | 43 de 66 (**65 %**) |
| Falló: nadie lo admitió en la sala de espera (15 min) | 9 |
| Falló: nunca llegó a la sala de espera (Meet no mostró el botón de unirse) | 7 |
| Detenido mientras se unía (`stopped_while_joining`) | 6 |
| Falló: el anfitrión lo rechazó | 1 |

En el CRM: 46 reuniones con asistente en DONE y 22 en FAILED.

| Origen de la reunión | OK | Fallo |
|---|---|---|
| Calendario personal del usuario | 3 | 6 |
| "Reunión en vivo" (link pegado) | 14 | 10 |
| Link pegado y agendado | 29 | 6 |

**Todos los fallos ocurren en la fase de entrada a Meet.** Ninguno es de transcripción, guardado o créditos. No apareció ningún error del CRM relacionado en los logs de las últimas 3 horas.

## 2. Por qué falla

El asistente entra a Meet como **invitado anónimo** ("abrir una ventana de incógnito y pegar el link"). Eso trae dos problemas:

1. **Alguien tiene que admitirlo.** Si el anfitrión no está, no mira la sala de espera, o la reunión es de una organización de Google Workspace donde solo ven la solicitud el anfitrión y los coanfitriones, el asistente espera 15 min y se rinde. En ese caso no queda grabación ni transcripción. Es la causa de 9 de los 22 fallos.
2. **Meet a veces no le deja entrar.** Meet lo manda a la página de promoción (`workspace.google.com/products/meet`) o no muestra el botón de unirse (sesión 105, hoy 16:35). Pasa en 7 de 66 sesiones. Recall.ai documenta bloqueos parecidos: filtro por nombre del bot, "cualquiera con el link puede pedir unirse" desactivado, y reuniones que exigen iniciar sesión.

### Defectos propios del código (no causan los fallos, pero agravan la experiencia)

- **Sin reintento tras un fallo de entrada.** Si Vexa dice `failed`, el CRM lo marca FAILED y no vuelve a intentar, ni siquiera cuando fue `never_reached_lobby`, que suele ser pasajero.
- **El usuario no se entera de que hay que admitir al asistente.** El estado "uniéndose" no distingue "en la sala de espera". Nadie avisa "admite al asistente". La reunión de hoy esperó 15 min sin que nadie lo supiera.
- **El motivo real no se muestra.** La interfaz solo dice "falló", aunque Vexa guarda la causa exacta (`join_evidence.reason`).
- **Entrada tardía en reuniones agendadas.** El asistente entra 1 min antes de la hora y espera 15 min. Si el anfitrión llega 20 min tarde, falla sin reintento.
- **Seguimiento más lento de lo diseñado.** El código dice cada 15 s, pero en la práctica corre cada ~60 s porque el cron procesa los trabajos una vez por minuto.
- **El cierre no es idempotente.** Si falla la bajada de la transcripción y el trabajo se repite, `vexa_bot_poll` vuelve a crear los adjuntos (transcripción, subtítulos) y quedan duplicados.
- **Comentario desactualizado.** `google-calendar.ts` dice que Meet "nunca pide admitir" porque la cuenta organizadora y el asistente serían la misma. Ya no es cierto: Vexa entra como invitado anónimo, no con esa cuenta.
- **Vexa desactualizado.** Corremos la imagen del 14-sep. La última versión es la **v0.12.28 (9-oct)**. Un issue abierto menciona un "Meet refused-join fix" en la v0.12.29 que aún no vi publicada. La transcripción usa la API de OpenAI (costo aparte).

## 3. Alternativas evaluadas

| Opción | Cómo entra | Resuelve la sala de espera | Costo / licencia | Veredicto |
|---|---|---|---|---|
| **Vexa (actual)** | Invitado anónimo | No | Apache-2.0, autoalojado. En la nube: US$0.30/h | Mantener y endurecer |
| **Recall.ai** | Anónimo, o con cuenta de Google si `login_required` | Solo con cuenta de Google en la invitación del evento. Tiempo máximo de espera en Meet: 600 s | US$0.50/h + US$0.15/h de transcripción. Código cerrado. Sin región en Latinoamérica | Misma mecánica de admisión, no es la solución mágica |
| **Attendee** | Anónimo, o con cuenta de Google (por SSO SAML) | Sí, con cuenta de Google. Exige un dominio de Workspace propio | Elastic License 2.0 (puedes autoalojar, no revender como servicio). Versión 1.89.2, muy activo, pero tuvo un arreglo por una rotura de Meet (v1.86.3) | Candidato si Vexa no puede entrar con cuenta |
| **Meet Media API (Google)** | Oficial, sin bot | Sí | En vista previa para desarrolladores: **todos los participantes** deben estar inscritos | No viable hoy |
| **Meet REST API** (grabaciones y transcripciones) | Sin bot, después de la reunión | No aplica | Requiere una edición de Workspace con grabación activada y que el anfitrión lo permita | Complemento para clientes con Workspace, no sustituto |
| **Extensión de Chrome (ya existe)** | Dentro del navegador de quien está en la llamada | No hace falta admisión | Ya está construida | Respaldo útil: nunca falla por la sala de espera |

Aclaración: no existe una "API de Meta" para reuniones de Meet. Meta (WhatsApp) no interviene aquí.

**No hay una opción que dé 100 %.** Todo bot externo depende de que lo admitan, salvo cuatro caminos: entrar con una cuenta invitada al evento, usar un espacio con acceso abierto, capturar desde el navegador de alguien que ya está dentro, o leer los datos después con la API de Google.

## 4. Plan recomendado (de menor a mayor esfuerzo)

**Fase 0 (horas), sin riesgo**
1. Mostrar en el CRM el estado "En la sala de espera: admite al asistente" y el motivo real del fallo.
2. Avisar al usuario cuando el asistente esté en la sala de espera, por la app o por WhatsApp.
3. Reintentar automáticamente (hasta 2 veces) cuando el motivo sea `never_reached_lobby`.
4. Corregir la duplicación de adjuntos en `vexa_bot_poll` y el comentario desactualizado.
5. Quitar los pasos de cron de 60 s: reprogramar de forma que el seguimiento sea de verdad cada 15 s mientras hay un bot en sala de espera.

**Fase 1 (1 a 2 días)**
6. Actualizar Vexa a v0.12.28 o superior y probarlo con una reunión real.
7. Para reuniones que crea el CRM: crear el espacio de Meet con la API oficial y `accessType: OPEN` (entra sin pedir permiso) o añadir la cuenta del asistente como invitado. Hay que verificar con una prueba que el permiso de OAuth lo permita.
8. Si el anfitrión llega tarde: mantener al asistente en espera más de 15 min o volver a intentar en un intervalo.

**Fase 2 (si lo anterior no llega a ≥ 95 %)**
9. Revisar `docs.vexa.ai` para confirmar si soporta entrar con cuenta de Google. Si no, evaluar Attendee con inicio de sesión (necesita dominio de Workspace propio y cuenta de bot).
10. Reforzar el respaldo con la extensión de Chrome y la REST API de Google para las reuniones donde el asistente falle.

## 5. Lo que no pude comprobar

- Por qué Meet redirigió a la página de promoción en la sesión 105 (hoy 16:35). Pudo ser una reunión aún no abierta o un bloqueo momentáneo de Google; el log interno del asistente no estaba accesible en el contenedor.
- Si Vexa soporta entrar con cuenta de Google (no aparece en el README ni en las notas de versión que leí; faltaba revisar `docs.vexa.ai`).
- Las cifras de precio de Recall.ai y Vexa en la nube salen de sus páginas oficiales y de una calculadora externa; confírmalas antes de decidir.
- Las 6 sesiones `stopped_while_joining` no las analicé: puede que sean paradas manuales.

## Fuentes

- Recall.ai: [Google Meet FAQ](https://docs.recall.ai/docs/google-meet-faq), [sala de espera](https://docs.recall.ai/docs/troubleshooting-google-meet-waiting-room), [precios](https://www.recall.ai/pricing), [regiones](https://docs.recall.ai/docs/regions)
- Vexa: [repositorio](https://github.com/Vexa-ai/vexa), [versiones](https://github.com/Vexa-ai/vexa/releases)
- Attendee: [repositorio](https://github.com/attendee-labs/attendee), [bots con sesión iniciada](https://github.com/attendee-labs/attendee/blob/main/docs/signed_in_bots.md)
- Google: [Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/get-started), [REST API v2](https://developers.google.com/workspace/meet/api/reference/rest/v2), [Space config](https://developers.google.cn/meet/api/reference/rest/v2/spaces?hl=en)

## 6. Capturas del asistente (3-nov-2026)

Vexa guardaba capturas con nombre fijo en su contenedor (cada una pisaba a la anterior). Las del 3-nov mostraron que **la sesión 106 terminó en la página de promoción de Google Meet**, no en la sala de espera: Meet sacó al asistente (la reunión terminó o dejó de estar activa) y Vexa, en el bucle de espera, siguió esperando los 15 min completos sin notarlo. El mensaje "nadie lo admitió" no siempre es la causa real.

Solución: `vexa-patches/apply-shots.js` manda al CRM una captura con la URL y el título de la página (al abrir el link, al entrar a la sala de espera, cada ~2 min, 1 min antes de agotar el tiempo y al agotarlo). El CRM las guarda como adjuntos de la reunión (7 días, con la limpieza diaria existente) y, si la URL muestra que Meet lo mandó a otra página, anota el motivo y saca al asistente al instante en vez de esperar 15 min. Los parches de Vexa (que solo estaban en el servidor, en `/opt/vexa-patches`) ahora viven en `vexa-patches/` del repo.
