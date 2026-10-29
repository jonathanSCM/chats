# Plan — Vender el CRM como servicio: marca propia, límite de usuarios y suborganizaciones

Revisado en el código el 29 oct 2026. No se cambió código: este documento es la propuesta.

## Qué ya existe (no hay que construirlo)

- **Multi-organización real.** Cada dato cuelga de `Organization` (contactos, chats, bots,
  reuniones, oportunidades…). Un usuario puede pertenecer a varias organizaciones
  (`OrganizationMembership`) y ya hay un selector de organización
  ([org-switcher.tsx](../src/components/layout/org-switcher.tsx)).
- **Panel del superadmin** en `/admin` (organizaciones, usuarios, ajustes, logs) y activación de
  funciones por organización (`jefeEnabled`, `suspended`).
- **Invitaciones** por enlace con rol (`OrganizationInvite`).
- **Asistente de reuniones y bots de WhatsApp por organización** (cada org tiene sus bots, su
  calendario, su Meta Ads).

## Qué falta

| Pedido | Hoy | Falta |
|---|---|---|
| Cambiar logo y nombre | Fijo en el código: "ProShop" en ~20 lugares (login, correos, instalación PWA, términos, asistente de reuniones, mensajes del bot) y logo en `/logo-mark.png` | Guardar marca por organización y usarla en esos lugares |
| Nombre propio del asistente | El bot de reuniones se llama `Asistente de {nombre de la org}`; el bot de WhatsApp tiene su nombre/prompt | Campo "nombre del asistente" editable |
| Limitar usuarios por organización | No hay ningún tope | Campo de límite + validación al crear/invitar/aceptar |
| Suborganizaciones | No existe jerarquía | `parentId` en la organización + reglas de visibilidad |

---

## 1. Marca propia por organización (white-label)

**Datos nuevos en `Organization`:** `brandName`, `logoUrl` (archivo subido), `brandColor`
(acento), `assistantName`, `supportEmail`, opcional `customDomain`.

**Dónde se aplica, por orden de valor:**
1. **Pantalla de inicio de sesión y barra lateral:** logo y nombre de la organización.
   *Detalle técnico:* el login no sabe de qué organización es el visitante; se resuelve por
   **subdominio o dominio propio** (`cliente.tuplataforma.com`) o por un enlace
   `/login?org=slug`.
2. **Correos** (invitaciones, recuperar contraseña): nombre y logo de la organización.
3. **PWA / instalar app:** `manifest` dinámico por organización (nombre, ícono, color).
4. **Asistente de reuniones y del bot:** `assistantName` en lugar de `Asistente de {org}`.
5. **Términos y privacidad:** el nombre legal de la organización.

**Quién lo edita:** el dueño de la organización desde `/dashboard/organization` (subir logo,
nombre, color) y el superadmin desde `/admin`. Sin marca configurada se usa la de la plataforma.

**Esfuerzo:** medio. La parte fácil (logo/nombre dentro de la app, asistente, correos) es de 1–2
días. El **dominio propio por cliente** es lo que más pesa: DNS + certificado + reconocer el
host en cada petición; conviene hacerlo después, en una segunda etapa.

## 2. Límite de usuarios por organización

**Datos:** `maxUsers Int?` en `Organization` (null = sin tope). Lo fija **solo el superadmin**
(es parte del plan que vendes), no el dueño.

**Dónde se valida** (todos los puntos que agregan gente):
- Crear invitación y **aceptar** invitación ([team.ts](../src/server/actions/team.ts),
  [admin.ts](../src/server/actions/admin.ts)).
- Crear usuario directo y alta por registro ([signup.ts](../src/server/actions/signup.ts)).
- Servicio central [organization-membership.ts](../src/server/services/organization-membership.ts).

**Cuenta como usuario:** miembros activos de la organización (con opción de no contar al
administrador de la plataforma). Mensaje claro: "Tu plan permite 5 usuarios".
Al **bajar** el tope por debajo de los usuarios actuales no se borra a nadie: solo se bloquean
altas nuevas.

**Opcionales a decidir:** límite también de bots de WhatsApp, de mensajes de IA al mes y de
almacenamiento (misma mecánica, mismos campos).

**Esfuerzo:** chico (medio día a 1 día).

## 3. Suborganizaciones

Es la más delicada porque toca **quién ve qué**. Propuesta mínima y segura:

**Modelo:** `parentId` en `Organization` (un solo nivel de profundidad al principio: padre →
hijas). Cada suborganización sigue siendo una organización completa y **aislada**: sus propios
contactos, chats, bots, reuniones.

**Reglas propuestas:**
- Un **administrador de la organización padre** puede entrar a cualquiera de sus hijas (usando el
  selector que ya existe) y crear nuevas.
- Una hija **no ve** a la padre ni a las hermanas.
- **Usuarios:** el tope de usuarios del padre es un **fondo compartido** entre él y sus hijas
  (opción A) o cada hija tiene el suyo (opción B). Recomiendo A: es lo que se vende
  ("plan de 20 usuarios para toda la empresa").
- **Marca:** las hijas heredan la del padre salvo que configuren la suya.
- **Reportes** (más adelante): vista consolidada para el padre (leads, ventas, gasto de anuncios
  de todas sus hijas).
- **Qué NO se comparte:** conversaciones, contactos y claves de WhatsApp/Meta. Cada hija conecta
  las suyas.

**Preguntas que cambian el diseño:**
1. ¿Una persona del padre debe ver **todos** los chats de las hijas, o solo entrar a una y
   cambiar de contexto? (Propongo lo segundo: más simple y sin mezclar datos.)
2. ¿Las hijas pueden crear sus propias sub-hijas? (Propongo no: un nivel.)
3. ¿Quién paga/factura: el padre por todo, o cada hija por separado?

**Esfuerzo:** medio-grande (3–5 días), principalmente por las pruebas de aislamiento de datos.

---

## Orden de trabajo sugerido

1. **Límite de usuarios** (chico, desbloquea vender planes).
2. **Marca propia dentro de la app** (logo, nombre, color, nombre del asistente, correos).
3. **Suborganizaciones** con visibilidad mínima + fondo compartido de usuarios.
4. **Dominio propio / subdominio por cliente** y PWA por organización.
5. **Reportes consolidados** para la organización padre.

## Riesgos a tener presentes

- **Aislamiento entre clientes:** cada consulta debe filtrar por organización. Al agregar
  jerarquía, hay que auditar que ningún filtro "se abra" por error a las hijas o al padre.
- **Marca en lugares olvidados:** mensajes del bot, correos, notificaciones push y términos
  todavía dicen "ProShop"; conviene una lista de verificación antes de entregarle a un cliente.
- **Datos de ProShop actual:** la migración debe dejar `brandName`/`logoUrl` vacíos para que lo
  existente siga viéndose igual.

## Decisiones tuyas

1. ¿Subdominio por cliente desde el principio, o primero solo logo/nombre dentro de la app?
2. Suborganizaciones: ¿fondo compartido de usuarios (A) o límite por hija (B)?
3. ¿El padre solo "entra" a las hijas o ve todo consolidado?
4. ¿Qué otros topes quieres en el plan: bots de WhatsApp, mensajes de IA, almacenamiento?
