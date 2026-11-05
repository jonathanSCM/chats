# Revisión de Meta: permiso `ads_read` — guion del video y texto de la solicitud

Motivo del rechazo (Política para desarrolladores 1.6): el permiso de uso está permitido, pero el video **no muestra la experiencia completa**.
Meta pide que el nuevo video incluya, sin cortes:

1. El **flujo de inicio de sesión de Meta completo** (el diálogo de Facebook y la pantalla de permisos).
2. Un **usuario con acceso a la app** para el permiso (alguien con rol en la app: administrador, desarrollador o probador).
3. La **experiencia completa del caso de uso** de `ads_read`: de dónde salen los datos y para qué se usan dentro del producto.

Y seguir su guía de grabación: **interfaz en inglés**, **subtítulos**, **información sobre las herramientas** (qué hace cada botón y pantalla).

## Qué hace `ads_read` en ProShop CRM (lo que hay que mostrar)

Solo lectura. El dueño de la organización conecta su cuenta publicitaria de Meta y el CRM lee **gasto, impresiones, alcance, clics, CTR, CPC y CPM** por campaña, conjunto de anuncios y anuncio. Con eso:
- calcula el costo por conversación, por oportunidad, por lead calificado y por propuesta, el CAC y el ROAS (cruzando el gasto con las conversaciones de WhatsApp que llegaron desde anuncios y las ventas ganadas);
- muestra el rendimiento del anuncio de origen dentro de cada conversación que vino de un anuncio de "clic a WhatsApp".

Rutas del producto: Organización → Integraciones → **Meta Ads** (conexión) · **Marketing** (panel) · **Chats** → una conversación de anuncio → **Inversión / Impresiones / Alcance / Clics…**.

## Antes de grabar (preparación)

- [ ] **Activar la función.** El panel de Marketing y el botón "Conectar con Facebook" están apagados hasta que Meta apruebe el permiso (`MARKETING_ENABLED`, ver `src/lib/features.ts`). Hay que encenderla en el entorno que se graba **y dejarla encendida mientras dure la revisión**: los revisores prueban la app en vivo.
- [ ] **Usuario con rol en la app.** Quien graba (y quien conecta) debe tener rol en la app de Meta (administrador, desarrollador o probador). Sin rol, Facebook no concede `ads_read`.
- [ ] **Cuenta publicitaria con datos reales.** Una cuenta con campañas, gasto en los últimos 30 días y, idealmente, un anuncio de "clic a WhatsApp" que haya generado conversaciones. Sin datos el panel se ve vacío.
- [ ] **Organización de prueba** en el CRM con: una persona con rol **Dueño** (solo el dueño puede conectar), un número de WhatsApp conectado, y al menos una conversación proveniente del anuncio (o marcarla a mano) con una oportunidad ganada, para que el embudo y el ROAS tengan valores.
- [ ] **Idioma.** Cuenta de Facebook en **inglés** (el diálogo de Meta sigue el idioma de la cuenta). El CRM ya tiene **modo inglés**: botón de idioma en el menú lateral (abajo, junto a Ajustes) y en Ajustes → Idioma. Están traducidos el menú, el inicio de sesión, Ajustes, Marketing, Organización → Integraciones → Meta Ads y el panel de rendimiento del anuncio en Chats. Cambiar a **English** antes de grabar y mantener los subtítulos sobrepuestos en inglés para explicar cada paso.
- [ ] **Resolución y ritmo.** 1080p o más, sin acelerar, el cursor visible, sin ventanas ajenas ni datos personales ajenos. Duración recomendada: 3 a 5 minutos.

## Guion del video (toma por toma)

Cada toma lleva un subtítulo en inglés (en cursiva) y, donde se indica, una anotación sobre el elemento.

1. **Presentación (0:00–0:20).** Pantalla de inicio de sesión del CRM, se entra con el usuario de prueba. *"ProShop CRM is a WhatsApp sales CRM. This is the organization owner, who also has a role in our Meta app."* Mostrar el nombre del usuario y el rol Dueño.
2. **Dónde se pide el permiso (0:20–0:40).** Organización → Integraciones → fila **Meta Ads**. Anotación: *"Read-only connection of the ad account to measure advertising spend."* Mostrar el texto "(solo lectura)".
3. **Inicio de sesión de Meta, completo (0:40–1:40).** Pulsar **Conectar con Facebook**. No recortar nada de lo que sigue:
   - el diálogo de inicio de sesión de Facebook (si ya hay sesión, mostrar la pantalla de "Continuar como…");
   - la pantalla de permisos donde se lee **"Access your ads data" / `ads_read`**, con las cuentas publicitarias para marcar; marcar la cuenta y continuar;
   - regreso al CRM con la cuenta publicitaria seleccionada (o la lista para elegir si hay varias).
   *"The user authorizes read access to one ad account through Meta's login."*
4. **Primera lectura de datos (1:40–2:00).** Pulsar **Sincronizar ahora**. *"The CRM reads spend, impressions, reach, clicks, CTR, CPC and CPM from the ad account."* Mostrar el mensaje de resultado.
5. **Uso de los datos en el panel (2:00–3:15).** Menú **Marketing**. Recorrer con el cursor, una por una:
   - el selector de fechas, **Gasto**, **CAC**, **ROAS**, **Ingreso ganado**;
   - **Costo / conversación**, **Costo / oportunidad**, **Costo / lead calificado**, **Costo / propuesta**;
   - el **Embudo** y el **Desglose por anuncio** (campaña, conjunto, anuncio con su gasto y clics).
   *"Spend read with ads_read is combined with WhatsApp conversations and won deals to show the real cost of each customer."*
6. **Uso dentro de una conversación (3:15–3:50).** Menú **Chats** → abrir una conversación que vino de un anuncio → en el panel lateral, pulsar el botón que trae el rendimiento del anuncio y mostrar **Inversión, Impresiones, Alcance, Clics, CTR, CPC, CPM**. *"Each lead shows the performance of the ad that brought it."*
7. **Control del usuario (3:50–4:15).** Volver a Integraciones → mostrar el botón **Desconectar** y que se puede revocar también desde la configuración de Facebook. *"The owner can disconnect at any time; data is only read, never written."*
8. **Cierre (4:15–4:30).** Mostrar los enlaces a la política de privacidad y a la eliminación de datos (`/privacy`, `/data-deletion`).

## Texto para el campo de notas de la solicitud (en inglés)

> **How we use ads_read.** ProShop CRM is a multi-tenant WhatsApp sales CRM. The organization owner connects their own Meta ad account with Facebook Login (Facebook Login for Business) and grants `ads_read` (read-only). We use the Marketing API **Insights** endpoint to read spend, impressions, reach, clicks, CTR, CPC and CPM per campaign, ad set and ad. We combine that spend with the WhatsApp conversations that came from click-to-WhatsApp ads and with won deals, to show the owner the real cost per conversation, per qualified lead, CAC and ROAS, and to show the performance of the ad that originated each conversation. We never create, edit or delete ads and we never write to the ad account.
>
> **Authentication.** This is **not** a server-to-server app and it does **not** use a system user token: the access token comes from the Facebook Login flow, which is shown in full in the screencast, using a user who has a role in the app. We exchange it for a long-lived token on our server and store it encrypted.
>
> **Screencast.** It shows, without cuts: (1) the owner opening Organization → Integrations → Meta Ads, (2) the complete Facebook Login flow and the permission dialog with `ads_read`, (3) selecting the ad account, (4) the first data sync, (5) the Marketing dashboard using the data, (6) the ad performance shown inside a conversation, and (7) disconnecting. The UI is shown in English with captions and tooltips explaining each button.
>
> **Test instructions for reviewers.** URL: https://chats.proshop.lat — log in with the test account below (role: Owner). Go to Organization → Integrations → Meta Ads → "Connect with Facebook" (the screencast shows this exact flow), then open "Marketing" in the left menu. Test account: *[email]* / *[password]* — create a dedicated account and rotate its password after the review.
>
> **Data.** Ad data is used only to show metrics to the same organization that authorized it; it is not sold, shared or used for advertising. Users can disconnect at any time and request deletion at https://chats.proshop.lat/data-deletion. Privacy policy: https://chats.proshop.lat/privacy.

## Lista de comprobación antes de reenviar

- [ ] El video muestra el inicio de sesión de Meta **de principio a fin** y la pantalla con `ads_read`.
- [ ] Se ve claramente quién es el usuario y que tiene rol en la app.
- [ ] Se ve el uso real de los datos (panel de Marketing y panel de conversación), no solo la conexión.
- [ ] Subtítulos y rótulos en inglés; cada botón importante tiene una anotación.
- [ ] La función de Marketing está **encendida** en producción durante la revisión.
- [ ] La cuenta de prueba para los revisores funciona y tiene datos para ver.
- [ ] Las notas coinciden palabra por palabra con lo que muestra el video (el rechazo fue justamente por esa diferencia).
- [ ] Política de privacidad y eliminación de datos accesibles y con la descripción del uso de datos de anuncios.
