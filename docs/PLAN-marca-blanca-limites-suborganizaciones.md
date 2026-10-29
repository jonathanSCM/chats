# Plan — Vender el CRM como servicio: planes por organización, marca propia, suborganizaciones y API de IA propia

Versión 2 (con las decisiones del dueño). Revisado contra el código; no se ha cambiado código todavía.

## La idea en una frase

El **superadmin** decide, organización por organización, qué puede hacer: tener suborganizaciones,
cuántos administradores y vendedores puede tener, si puede cambiar su marca y si usa su propia
clave de IA. La organización solo ve y usa lo que se le habilitó.

## Panel del superadmin (por organización)

| Opción | Valores | Qué hace |
|---|---|---|
| Puede tener suborganizaciones | Sí / No | Habilita crear organizaciones hijas |
| Máx. suborganizaciones | número (vacío = sin tope) | Solo si lo anterior es Sí |
| Máx. administradores | número (vacío = sin tope) | Tope de usuarios OWNER |
| Máx. vendedores | número (vacío = sin tope) | Tope de usuarios MEMBER |
| Puede cambiar su marca | Sí / No | Habilita logo, nombre, color y nombre del asistente |
| Usa su propia API de IA | Sí / No | Habilita el campo "Mi clave de OpenAI" en sus integraciones |
| Dominio propio | — | **No por ahora** (se muestra "próximamente") |

Todo vacío o en "No" = comportamiento actual. Lo que ya existe no cambia.

## Qué ya existe en el código

- Datos separados por organización; un usuario puede pertenecer a varias (`OrganizationMembership`)
  y hay selector de organización.
- Panel `/admin` (organizaciones, usuarios, ajustes) e invitaciones por enlace con rol.
- **Toda la IA pasa por un solo archivo** ([ai/client.ts](../src/server/services/ai/client.ts)):
  hoy usa `OPENAI_API_KEY` del entorno. Es lo que hace sencillo el punto de la API propia.
- Ya existe cifrado de secretos (`encrypt`/`decrypt`, `APP_ENCRYPTION_KEY`), como en el token de Meta Ads.

---

## 1. Planes y límites (admins y vendedores)

- Campos en `Organization`: `maxAdmins Int?`, `maxSellers Int?` (null = sin tope).
- Solo el superadmin los edita.
- Se validan donde entra gente: crear/aceptar invitación, registro y alta directa
  ([team.ts](../src/server/actions/team.ts), [admin.ts](../src/server/actions/admin.ts),
  [signup.ts](../src/server/actions/signup.ts), `organization-membership.ts`).
- Mensajes claros ("Tu plan permite 3 vendedores; tienes 3").
- Si bajas el tope por debajo de lo actual, no se borra a nadie: solo se bloquean altas nuevas.
- El administrador de la plataforma (SUPERADMIN) y las cuentas técnicas no cuentan.

## 2. Suborganizaciones

**Modelo:** `parentId` en `Organization` y la bandera `canHaveSubOrgs`. Un solo nivel
(padre → hijas). Cada hija sigue siendo una organización completa y **aislada**.

**Cómo funciona con tu idea de "qué vendedores usa cada hija":**
- El administrador del padre crea una suborganización y **elige a cuáles de los vendedores del
  padre** asigna a ella (los puede mover o quitar después).
- Esos vendedores aparecen en la hija como miembros (mismo `OrganizationMembership`, rol vendedor),
  y cambian entre padre e hijas con el selector que ya existe.
- **Los límites son un fondo compartido:** los `maxAdmins`/`maxSellers` del padre se reparten entre
  él y todas sus hijas. Un vendedor que está en el padre y en dos hijas **cuenta una sola vez**.
  (Ej.: plan de 10 vendedores = 10 personas distintas en todo el grupo.)
- La hija no ve a la padre ni a las hermanas. El padre **entra** a cada hija (no ve todo mezclado).
- La hija hereda la marca del padre salvo que ella tenga la suya (si el padre lo permite).
- No se comparte: chats, contactos, claves de WhatsApp/Meta. Cada hija conecta las suyas.
- Solo un nivel por ahora (una hija no crea sub-hijas).

## 3. Marca propia

- Campos: `brandName`, `logoUrl`, `brandColor`, `assistantName`. Solo editables si el superadmin
  puso "Puede cambiar su marca = Sí".
- Se aplica en: login/barra lateral (dentro de la app), correos, instalación de la app (PWA),
  nombre del asistente de reuniones (hoy `Asistente de {org}`) y del bot, y términos/privacidad.
- Hoy "ProShop" está fijo en ~20 lugares; se reemplaza por la marca de la organización con
  la de la plataforma como respaldo.
- **Sin dominio propio** por ahora: el login sigue siendo uno solo; la marca se ve al entrar.
  (Si quieres una portada de login por cliente, se hace con `/login?org=slug` sin dominio nuevo.)

## 4. API de IA propia por organización

**Qué pediste:** el superadmin marca "esta organización usa su propia API"; entonces el dueño de la
organización padre ve en **Integraciones** un campo para guardar su clave. Si no tiene la opción,
se usa la del entorno (`OPENAI_API_KEY`).

**Cómo se haría:**
- `Organization.aiOwnKeyEnabled Boolean` (lo pone el superadmin) y `Organization.openaiApiKeyEnc Text?`
  (la clave del cliente, **cifrada**, nunca visible después de guardarla: solo "…últimos 4").
- Al guardar, se **valida** con una llamada de prueba a OpenAI antes de aceptarla.
- `ai/client.ts` elige la clave por organización: si la tiene y está habilitada, usa la suya;
  si no, la del entorno. Hay que crear un cliente por clave (con caché) y pasar el
  `organizationId` a las funciones de IA (la mayoría ya lo recibe).
- **Las hijas usan la clave del padre**, para que el padre pague todo su grupo.
- Si la clave del cliente falla (sin saldo, revocada): se avisa al dueño y **no se hace caída
  automática a la clave de la plataforma** (para no gastar tu saldo sin querer). Esto es una
  decisión a confirmar.
- El presupuesto diario de IA (`isWithinBudget`) sigue funcionando por organización.
- Alcance a revisar: transcripción de audios y resumen de reuniones también usan OpenAI; deben
  respetar la misma regla.

---

## Mi opinión

Me parece un buen diseño: un solo panel de "interruptores" por cliente, sin tocar lo que ya anda.
Tres cosas que sugiero:
1. **Fondo compartido entre padre e hijas** para los límites (no uno por hija), contando personas
   distintas. Es lo más fácil de vender y de entender.
2. **Sin caída automática a tu clave** cuando falla la del cliente; así nunca pagas tú por error.
3. **Empezar por límites + panel de superadmin**, porque desbloquea vender planes ya, y dejar
   suborganizaciones para el final (es lo que más pruebas de aislamiento requiere).

## Orden de trabajo

1. Panel de superadmin con las opciones + límites de admins/vendedores (chico, 1–2 días).
2. Marca propia dentro de la app (1–2 días).
3. API de IA propia por organización (1–2 días; es contenido por `ai/client.ts`).
4. Suborganizaciones con asignación de vendedores y fondo compartido (3–5 días).

## Riesgos

- **Aislamiento:** cada consulta filtra por organización; al meter jerarquía hay que auditar que
  ninguna se abra por error. Se acompaña con pruebas automáticas de "hija no ve datos del padre".
- **Clave del cliente:** se guarda cifrada, no se imprime en logs ni se devuelve al navegador.
- **Marca en lugares olvidados:** lista de verificación antes de entregar a un cliente.
- **Migración:** todos los campos nuevos nacen apagados/vacíos; ProShop actual sigue igual.

## Decisiones pendientes (solo estas)

1. ¿Confirmas **sin caída automática** a la clave de la plataforma si falla la del cliente?
2. ¿Los límites de admins/vendedores son **fondo compartido** del grupo (recomendado)?
3. ¿Empiezo por el paso 1 (panel + límites)?
