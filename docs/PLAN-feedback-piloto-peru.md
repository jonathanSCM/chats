# Plan — Feedback del piloto Perú (Mariana, 29 oct 2026)

Estado según lo que revisé en el código y en los logs de producción. "Hecho" significa subido a
`main`; todo lo hecho necesita redespliegue del CRM para estar en producción.

## Resumen

| # | Tema | Estado hoy | Siguiente paso | Esfuerzo |
|---|---|---|---|---|
| 2.1 | "Necesidad / Contexto" en el título que ve el cliente | **Causa encontrada** | Título real, separado del contexto | Chico |
| 2.2 | Bot no entra por enlace de Meet | **Hecho** (commits `8e2f7be`, `c31ff17`) | Redeploy | — |
| 2.3 | Bot se sale de la llamada | **Causa encontrada y regla puesta en Vexa** | Vigilar 1–2 reuniones | — |
| 1.1 | Guardado falla al primer intento | **Mitigado** (`1bd652a`, `f0012b4`) | Redeploy y medir | — |
| 4.1 | Ficha no accesible desde el celular | **Causa probable** | Menú "⋯" con los botones de la cabecera | Chico |
| 4.2 | Teléfono visible / llamar | Falta | Mostrar número con enlace `tel:` | Muy chico |
| 3.2 | Salientes del celular no aparecen hasta la respuesta | **Por diagnosticar** | Un ejemplo concreto de Mariana | Medio |
| 3.3 | Archivar sincronizado con WhatsApp Business | **Probable límite de Meta** | Confirmar en la doc de Meta | Por ver |
| 2.4 | Pestaña única de reuniones | Propuesta | Ver detalle abajo | Medio |
| 2.5 | Calendario/categoría "ProShop" en Google | Propuesta | Ver detalle abajo | Chico–medio |
| 3.4 | Guardar contacto CRM ↔ teléfono | **Parcialmente imposible** | Alternativas abajo | Por ver |
| 3.1 | Contactos con username | **Hecho** (`0541948`) | Redeploy (ya en prod desde el 28) | — |

---

## Lo que ya está resuelto o mitigado

**2.2 Enlace de Meet.** El bot ahora entiende `/meet/`, `/lookup/`, el código suelto, enlaces sin
`https`, envueltos por Google y cortos; el campo del enlace acepta solo el código y se guarda
normalizado. Además un `409` de Vexa ya no marca la reunión como FALLÓ.

**2.3 Bot se cae.** Causa confirmada en los logs de Vexa: todas las salidas son `left_alone`, es
decir, el bot se iba tras **2 minutos de silencio**. Ya instalé una regla en Vexa: durante los
primeros 30 minutos no puede irse; los 2 minutos de silencio se cuentan desde el minuto 30.
Vexa se reinició y la regla está activa. Queda observar en reuniones reales. Aparte: si el bot
"no entra" a una reunión concreta, puede ser que Meet la tenga restringida a invitados (el bot
entra sin cuenta de Google y Meet lo rechaza al instante; pasó con `ybq-phmv-mrg`).

**1.1 Guardado.** Dos causas posibles actuando juntas: (a) pestañas abiertas desde antes de un
despliegue, cuyas acciones ya no existen en el servidor y se quedan "cargando"; (b) la página de
Seguimiento mandaba al navegador el texto de todas las transcripciones. Ya corregí (b) y añadí
un aviso "Está tardando… Recargar" a los 15 s en Agregar a seguimiento, Guardar contacto y Guardar
reunión. Falta medir tras el redeploy; si persiste, necesito la hora y el dispositivo.

**3.1 Usernames.** Resuelto (mensajes sin teléfono, ecos y envíos con BSUID).

---

## Pendiente — con propuesta

### 2.1 Título de la reunión (Alta)
**Causa:** al crear una reunión desde Seguimiento, el título del evento de Google Calendar se arma
como `Reunión con {cliente} — {Necesidad / Contexto}` ([crm.ts:498](../src/server/actions/crm.ts)).
Esa es la invitación que ve el cliente.

**Plan:**
1. Campo nuevo **"Título de la reunión"** (lo que ve el cliente) en los formularios de crear y
   editar reunión (chat, Seguimiento, Reuniones). Por defecto: `Reunión con {empresa o nombre}`.
2. Nunca más concatenar `opportunity.title` ni el contexto en título, descripción ni invitados.
3. Revisar también la descripción del evento y el nombre del bot ("Asistente de …") por si
   filtran datos internos.
4. Para reuniones ya creadas: no se tocan los eventos existentes salvo que se editen.

### 4.1 y 4.2 Móvil (Alta / Media)
**Causa probable de 4.1:** el botón que abre la ficha está en la barra de botones de la cabecera del
chat, que en el celular no entra y queda cortada. En el escritorio la ficha es una columna aparte.
**Plan:** en pantallas chicas, agrupar los botones de la cabecera en un menú **"⋯"** (ficha,
archivar, bloquear, silenciar, asignar…), con la ficha como primera opción y a pantalla completa.
**4.2:** mostrar el teléfono en la ficha y en la cabecera como enlace `tel:` (llamar con un toque)
y botón "copiar".
Se puede verificar en el emulador del navegador (Chrome en modo móvil) antes de subir.

### 3.2 Mensajes salientes del celular (Media-alta) — hace falta diagnóstico
En los logs de producción de hoy el CRM **sí recibió 29 ecos** de mensajes enviados desde la app
(`smb_message_echoes`) y no hay errores al procesarlos, así que el mecanismo funciona al menos en
parte. Hipótesis a descartar, en este orden:
1. **Chat duplicado:** si el cliente tiene username, su chat puede estar guardado con el BSUID y el
   eco llega con el teléfono (o al revés): el mensaje queda en otro chat. Se arregla guardando
   ambos identificadores en el contacto y buscando por cualquiera.
2. **Cliente nuevo que nunca escribió:** Meta podría no mandar el eco hasta que haya respuesta.
3. **Orden/visibilidad en la lista** (no sube el chat o no cuenta como "sin leer").
**Necesito:** un ejemplo — número del cliente y hora del mensaje que no apareció. Con eso lo busco
en el log del webhook y lo confirmo en minutos.

### 3.3 Archivar sincronizado (Media) — probable límite de Meta
Los avisos de Coexistence cubren mensajes, ecos, historial y contactos. **No encontré** un aviso de
"chat archivado" ni una API para archivar en la app, así que el sentido teléfono→CRM y CRM→teléfono
probablemente **no es posible**. Verificaré en la documentación de Meta antes de prometerlo. Si no se
puede: el archivado del CRM queda como "propio del CRM" y se aclara en pantalla para que no confunda.
Lo mismo aplica a bloquear y silenciar.

### 2.4 Pestaña única de Reuniones (Media)
Ya existe la pestaña **Reuniones** (reuniones sueltas) y Seguimiento tiene las suyas. Plan:
1. Unir ambas en una sola lista: reunión → cliente/contacto → seguimiento (opcional).
2. Agrupar **por día/fecha** o **por cliente**, con **buscador** (cliente, título, enlace) y filtros
   (estado, responsable, con/sin seguimiento).
3. Poder **asociar a un seguimiento existente** cualquier reunión que se creó suelta.
4. Calendario propio de reuniones agendadas dentro del CRM (vista mes/semana), que ya existe en
   parte en `/dashboard/calendario`; se integra con esta lista.
Nota: ya hay trabajo de otra sesión sin commitear sobre reuniones de equipo (`isTeam`, API de
integraciones); conviene cerrarlo antes de tocar esta pantalla para no pisarlo.

### 2.5 Calendario "ProShop" en Google (Media)
Opción A (recomendada, simple): crear los eventos con **color propio** y una **propiedad extendida**
de ProShop, para poder filtrarlos. Opción B: crear un **calendario secundario "ProShop CRM"** en la
cuenta de cada vendedor y poner ahí los eventos (requiere un permiso de Google adicional y
reconectar la cuenta). Pregunta para ti: ¿prefieres color o calendario aparte?

### 3.4 Guardar contacto CRM ↔ teléfono (Baja)
- **Teléfono → CRM:** ya llega por la sincronización de Coexistence (contactos del negocio).
- **CRM → teléfono:** WhatsApp Business **no** permite escribir contactos en la agenda del teléfono
  por API. Alternativas reales: (1) **descargar la ficha como tarjeta `.vcf`** que el celular importa
  con un toque; (2) sincronizar con **Google Contacts** (el celular Android los baja solo). Propongo
  empezar por el `.vcf` (muy chico) y evaluar Google Contacts después.

---

## Orden sugerido

1. **Hoy:** redesplegar el CRM (junta 2.2, 1.1, 3.1) y confirmar que 1.1 mejoró.
2. **Siguiente tanda (rápida, alto impacto):** 2.1 título real, 4.1 menú "⋯" en móvil, 4.2 teléfono
   con `tel:`, `.vcf` de 3.4.
3. **Con ejemplo de Mariana:** 3.2 salientes (diagnóstico + arreglo; si es BSUID, unificar identificadores).
4. **Tanda de reuniones:** 2.4 pestaña única + calendario, 2.5 calendario ProShop.
5. **Investigar:** 3.3 archivar/bloquear (probable límite de Meta).

## Datos que necesito (la lista de "Datos para reproducir")
- 1.1: navegador y dispositivo donde falla; hora aproximada.
- 2.1: dos invitaciones con fecha y cliente (para confirmar que el título filtraba el contexto).
- 2.3: fecha/hora de las reuniones donde el bot se cayó (para cruzar con los logs de Vexa).
- 3.2: un mensaje saliente que no apareció (número y hora).

## Decisiones tuyas
1. 2.5: ¿color o calendario aparte?
2. 3.4: ¿empezamos por `.vcf`?
3. ¿Cierro primero lo de reuniones de equipo (la otra sesión) antes de rehacer la pestaña de Reuniones?
