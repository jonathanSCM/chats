/**
 * Inglés. La clave es el texto en español tal como está en el código (ver `t()` en index.ts); si falta una clave, la pantalla
 * muestra el español. Las llaves {así} se conservan iguales: el test de i18n comprueba que coincidan con la clave.
 */
export const en: Record<string, string> = {
  // Menú lateral y avisos globales
  Seguimiento: "Follow-up",
  Calendario: "Calendar",
  Reuniones: "Meetings",
  "Conexión WhatsApp": "WhatsApp connection",
  Conocimiento: "Knowledge",
  Aprendizaje: "Learning",
  Organización: "Organization",
  "Sin organización": "No organization",
  Ajustes: "Settings",
  Salir: "Sign out",
  "Cuenta suspendida": "Account suspended",
  "Cambiar a modo claro": "Switch to light mode",
  "Cambiar a modo oscuro": "Switch to dark mode",
  "Modo claro": "Light mode",
  "Modo oscuro": "Dark mode",
  "Abrir menú": "Open menu",
  "Cerrar menú": "Close menu",
  "Cambiar de organización": "Switch organization",
  "Cerrar selector de organización": "Close organization selector",
  "Mostrar u ocultar el menú": "Show or hide the menu",

  // Inicio de sesión
  "Bandeja de conversaciones de WhatsApp": "WhatsApp conversation inbox",
  "Tu cuenta ya no pertenece a ninguna organización. Si crees que es un error, contacta al dueño de tu equipo.":
    "Your account no longer belongs to any organization. If you think this is a mistake, contact your team owner.",
  Correo: "Email",
  Contraseña: "Password",
  "¿Olvidaste tu contraseña?": "Forgot your password?",
  "Ingresando…": "Signing in…",
  Ingresar: "Sign in",

  // Ajustes
  "Preferencias de este dispositivo y conexiones de tu cuenta.": "Preferences for this device and connections of your account.",
  Idioma: "Language",
  "Idioma de la interfaz. Se guarda en este navegador; las pantallas que todavía no están traducidas siguen en español.":
    "Interface language. It is saved in this browser; screens that are not translated yet stay in Spanish.",
  "Google Calendar": "Google Calendar",
  "Conecta tu cuenta para que las reuniones que crees se agenden directo en tu calendario (con sincronización en las dos direcciones: lo que edites acá o en Google se refleja del otro lado).":
    "Connect your account so the meetings you create are scheduled directly in your calendar (two-way sync: what you edit here or in Google shows up on the other side).",
  "Google Calendar conectado — tus próximas reuniones se van a crear ahí.": "Google Calendar connected — your next meetings will be created there.",
  "No se pudo conectar: {error}": "Could not connect: {error}",
  "Conectado como": "Connected as",
  "Desconectando…": "Disconnecting…",
  "Conectar mi Google Calendar": "Connect my Google Calendar",
  "Instalar en mi dispositivo": "Install on my device",
  "Acceso directo en tu pantalla de inicio, pantalla completa y avisos de mensajes nuevos.":
    "A shortcut on your home screen, full-screen mode and new-message alerts.",
  "Ya estás usando la app instalada en este dispositivo.": "You are already using the installed app on this device.",
  "Tu teléfono usa": "Your phone runs",
  "En ese Android, la app instalada desde Chrome se cierra al abrirla: es una limitación de Chrome, no de ProShop, por eso no te ofrecemos instalarla.":
    "On that Android version, an app installed from Chrome closes as soon as it opens: it is a Chrome limitation, not a ProShop one, so we do not offer to install it.",
  "Para tener un acceso directo en la pantalla de inicio: en Chrome toca los tres puntos →":
    "To get a shortcut on your home screen: in Chrome tap the three dots →",
  "Agregar a pantalla de inicio": "Add to Home screen",
  "y, si te da a elegir, escoge": "and, if it lets you choose, pick",
  "Crear acceso directo": "Create shortcut",
  "(no «Instalar»). Se abrirá en Chrome.": "(not “Install”). It will open in Chrome.",
  "Si ya instalaste la app y se cierra, mantén presionado su ícono y desinstálala.":
    "If you already installed the app and it closes, long-press its icon and uninstall it.",
  "Abriendo…": "Opening…",
  "Estás dentro de otra app (WhatsApp, Instagram…) y desde ahí no se puede instalar. Toca los tres puntos y elige":
    "You are inside another app (WhatsApp, Instagram…) and you cannot install from there. Tap the three dots and choose",
  "Abrir en el navegador": "Open in browser",
  "(Chrome o Safari); luego vuelve a esta pantalla.": "(Chrome or Safari); then come back to this screen.",
  "En iPhone o iPad: toca": "On iPhone or iPad: tap",
  Compartir: "Share",
  "(o el menú": "(or the menu",
  "Si no lo ves, toca": "If you do not see it, tap",
  "Ver más": "See more",
  "Deja activado": "Leave",
  "Abrir como app web": "Open as web app",
  "y toca": "turned on and tap",
  Agregar: "Add",
  "así se abre en pantalla completa y puede recibir avisos de mensajes nuevos.":
    "so it opens full screen and can receive new-message alerts.",
  "Si tu navegador no muestra esa opción, ábrelo en Safari.": "If your browser does not show that option, open it in Safari.",
  "Tu navegador no ofrece la instalación con un botón en este momento. Abre el menú del navegador (los tres puntos) y elige":
    "Your browser does not offer a one-tap install right now. Open the browser menu (the three dots) and choose",
  "Instalar aplicación": "Install app",
  o: "or",
  "Tu navegador es antiguo: actualiza Chrome y «Android System WebView» desde Play Store (versión 111 o mayor).":
    "Your browser is out of date: update Chrome and “Android System WebView” from the Play Store (version 111 or later).",

  // Mi perfil
  "Mi perfil": "My profile",
  Nombre: "Name",
  "Cómo te ven tus compañeros en el CRM (chats asignados, notas, reuniones).": "How your teammates see you in the CRM (assigned chats, notes, meetings).",
  "Tu nombre": "Your name",
  Guardar: "Save",
  "Guardando…": "Saving…",
  Color: "Color",
  "Te identifica de un vistazo en la bandeja y en Seguimiento.": "Identifies you at a glance in the inbox and in Follow-up.",
  "Pedimos la actual para confirmar que sos vos, aunque ya tengas sesión iniciada.":
    "We ask for your current one to confirm it is you, even though you are already signed in.",
  "Contraseña actual": "Current password",
  "Contraseña nueva": "New password",
  "Repetir contraseña nueva": "Repeat new password",
  "Cambiar contraseña": "Change password",
  "El idioma, Google Calendar y la instalación en tu dispositivo están en":
    "Language, Google Calendar and installing on your device are in",

  // Bandeja: anuncio de origen y rendimiento
  Anuncio: "Ad",
  "Marcar anuncio": "Mark as ad",
  Llamar: "Call",
  "Traer inversión, impresiones, alcance, clics, CTR, CPC y CPM de este anuncio desde Meta":
    "Fetch this ad's spend, impressions, reach, clicks, CTR, CPC and CPM from Meta",
  "cargando…": "loading…",
  "ver rendimiento": "view performance",
  Inversión: "Spend",
  Impresiones: "Impressions",
  Alcance: "Reach",
  Clics: "Clicks",
  "Conjunto de anuncios": "Ad set",

  // Marketing
  "Embudo comercial conectado al gasto de Meta Ads.": "Sales funnel connected to your Meta Ads spend.",
  "Todavía no hay cuenta publicitaria conectada": "No ad account connected yet",
  "Conecta tu cuenta publicitaria con Facebook en Organización → Integraciones para que empiece a sincronizarse el gasto: después se actualiza sola cada ~20 horas.":
    "Connect your ad account with Facebook in Organization → Integrations so spend starts syncing; after that it updates by itself about every 20 hours.",
  "Ir a Organización →": "Go to Organization →",
  Desde: "From",
  Hasta: "To",
  "Todo vendedor": "All sellers",
  "Toda fuente": "All sources",
  "Todo servicio": "All services",
  "Toda ciudad": "All cities",
  "Toda campaña": "All campaigns",
  "Todo conjunto": "All ad sets",
  "Todo anuncio": "All ads",
  "Quitar filtros": "Clear filters",
  "Calculando…": "Calculating…",
  "{count} oportunidad(es) con valor en otra moneda no entran en ingreso, pipeline, CAC ni ROAS (la cuenta publicitaria está en {currency}).":
    "{count} opportunity(ies) with a value in another currency are not included in revenue, pipeline, CAC or ROAS (the ad account is in {currency}).",
  Gasto: "Spend",
  "Ingreso ganado": "Won revenue",
  "Costo / conversación": "Cost / conversation",
  "Costo / oportunidad": "Cost / opportunity",
  "Costo / lead calificado": "Cost / qualified lead",
  "Costo / propuesta": "Cost / proposal",
  "Tasa de calificación": "Qualification rate",
  "Valor del pipeline": "Pipeline value",
  Oportunidades: "Opportunities",
  Ganadas: "Won",
  Embudo: "Funnel",
  "Desglose por anuncio": "Breakdown by ad",
  "Ordenado por gasto.": "Sorted by spend.",
  "Sin datos todavía — el sync corre solo cada ~20h, puede tardar en aparecer la primera vez.":
    "No data yet — the sync runs by itself about every 20 hours, so the first run may take a while to appear.",
  Conjunto: "Ad set",
  Campaña: "Campaign",
  Ganados: "Won",

  // Organización → Integraciones → Meta Ads
  Administrar: "Manage",
  Conectar: "Connect",
  Conectada: "Connected",
  "Hay que volver a conectarla": "It needs to be reconnected",
  "No conectada": "Not connected",
  "Conecta tu cuenta publicitaria con Facebook (solo lectura) para ver el gasto junto a tus ventas en Marketing — se sincroniza sola cada ~20h.":
    "Connect your ad account with Facebook (read-only) to see your spend next to your sales in Marketing — it syncs by itself about every 20 hours.",
  "Falta el Config ID de Meta Ads en la configuración de plataforma (/admin/settings).":
    "The Meta Ads Config ID is missing from the platform settings (/admin/settings).",
  "No se pudo cargar el SDK de Facebook. Si tienes un bloqueador de anuncios o rastreadores, desactívalo para este sitio.":
    "The Facebook SDK could not be loaded. If you use an ad or tracker blocker, turn it off for this site.",
  "Sincronizado.": "Synced.",
  "Elige la cuenta publicitaria que quieres usar:": "Choose the ad account you want to use:",
  "Usar esta cuenta": "Use this account",
  "Conectado:": "Connected:",
  "Consultando Meta…": "Querying Meta…",
  "Sincronizar ahora": "Sync now",
  Desconectar: "Disconnect",
  "Última sincronización:": "Last sync:",
  "todavía no se sincronizó": "has not synced yet",
  "La conexión con Meta Ads venció o fue revocada. Vuelve a conectar para seguir sincronizando el gasto.":
    "The Meta Ads connection expired or was revoked. Reconnect to keep syncing spend.",
  "Cargando…": "Loading…",
  "Conectando…": "Connecting…",
  "Reconectar con Facebook": "Reconnect with Facebook",
  "Conectar con Facebook": "Connect with Facebook",
  Editar: "Edit",
  "hora de {zone}": "{zone} time",
  "Google Calendar del equipo": "Team Google Calendar",
  "Quién tiene su calendario conectado. Las reuniones que agenda el bot van al calendario de la persona asignada si lo conectó; si no, al calendario compartido de la organización.":
    "Who has their calendar connected. Meetings the bot schedules go to the assigned person's calendar if they connected one; otherwise to the organization's shared calendar.",
  "{n} conexión(es) se desconectaron: esas reuniones no llegan al Google de esa persona (van al calendario compartido). Pídele que vuelva a conectarlo en Ajustes.":
    "{n} connection(s) got disconnected: those meetings don't reach that person's Google (they go to the shared calendar). Ask them to reconnect in Settings.",
  "Calendario compartido de la organización": "Organization shared calendar",
  "Creado en la cuenta de Google del CRM. Es el de respaldo cuando quien atiende no conectó el suyo.":
    "Created in the CRM's Google account. It's the fallback when the assigned person hasn't connected theirs.",
  "Todavía no se creó: se crea con la primera reunión que lo necesite.": "Not created yet: it's created with the first meeting that needs it.",
  Activo: "Active",
  "Sin crear": "Not created",
  Conectado: "Connected",
  "Desconectado — debe volver a conectar": "Disconnected — needs to reconnect",
  "Conectado (no se pudo verificar ahora)": "Connected (couldn't verify right now)",
  "Sin conectar": "Not connected",
  "Cada persona conecta el suyo en": "Each person connects theirs in",
  "Funcionando: {ok} de {total}.": "Working: {ok} of {total}.",
  "Ver el calendario compartido en tu Google": "See the shared calendar in your Google",
  "Dale acceso de lectura a tu correo para ver todas las reuniones de la organización en un solo calendario.":
    "Give your email read access to see all the organization's meetings in one calendar.",
  "Sacar acceso": "Remove access",
  "correo@ejemplo.com": "email@example.com",
  "Compartiendo…": "Sharing…",
  "Tu Google Calendar ({email}) se desconectó. Las reuniones nuevas ya no llegan a tu calendario hasta que lo vuelvas a conectar.":
    "Your Google Calendar ({email}) got disconnected. New meetings won't reach your calendar until you reconnect it.",
  "Volver a conectar": "Reconnect",

  // Organización: pestañas (se traducen por variable, el test no las ve), subtítulo y filas de Integraciones
  General: "General",
  "Plan y créditos": "Plan & credits",
  Equipo: "Team",
  Ventas: "Sales",
  Integraciones: "Integrations",
  Suborganizaciones: "Sub-organizations",
  "Datos, plan, equipo, ventas e integraciones.": "Details, plan, team, sales and integrations.",
  "Inteligencia artificial": "Artificial intelligence",
  Ver: "View",
  "Este mes: {usage}": "This month: {usage}",
  "Con límite mensual": "With a monthly limit",
  "Tu plan incluye IA con un límite mensual. Si lo alcanzas, la IA se detiene hasta el mes siguiente o hasta que el administrador de la plataforma lo amplíe.":
    "Your plan includes AI with a monthly limit. If you reach it, AI stops until next month or until the platform administrator raises it.",
  "Clave de OpenAI": "OpenAI key",
  Configurar: "Configure",
  "Hay un problema con la clave": "There is a problem with the key",
  "Clave terminada en {last4}": "Key ending in {last4}",
  "Sin clave cargada": "No key loaded",
  "El bot de WhatsApp, el asesor y los resúmenes de reuniones pueden funcionar con tu propia cuenta de OpenAI en vez de la de la plataforma.":
    "The WhatsApp bot, the advisor and the meeting summaries can run on your own OpenAI account instead of the platform's.",
};
