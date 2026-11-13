# ProShop CRM — Asistente de reuniones de Meet (extensión de Chrome, v2.8)

Graba **los subtítulos y el audio** de tus reuniones de Google Meet y los guarda en tu CRM, con un **panel lateral** que
muestra los subtítulos en vivo (y se puede separar en su propia ventana). Corre en tu navegador, como un participante
más: no hay bot, nadie tiene que admitirlo.

## Cómo probarla (modo desarrollador)

1. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
2. **Cargar descomprimida** → elige esta carpeta (`meet-captions-extension`).
3. Fija el ícono (el rompecabezas de la barra → alfiler).
4. Fuera de una sala de Meet, el ícono abre un menú: **Nueva reunión**, **Unirse con enlace o código** y **Abrir Google Meet**. Dentro de una sala, **un clic en el ícono** abre el panel con todo (los **Ajustes** están en el engranaje de arriba a la derecha del panel).
5. Si no has iniciado sesión, el panel muestra **Iniciar sesión y permitir el micrófono** (un solo paso; usa tu sesión, sin tokens).
6. (Nombre y organización si quieres) → **Grabar esta reunión**. Chrome pide el permiso del micrófono una sola vez.

**Audio, dos formas.** Automática: Chrome da la captura de la pestaña si abriste el asistente **con un clic en el ícono** de la extensión (el
panel se abre desde el evento de clic del ícono, que es lo que Chrome cuenta como «invocar la extensión»). Si abriste el panel de otra
forma (botón del logo en Meet), el botón de grabar va directo al selector de pestañas. Si no la da
(o prefieres no depender de eso), el panel muestra el botón **«Elegir la pestaña de Meet (audio)»**: Chrome abre su selector, eliges la
pestaña de Meet y marcas «Compartir audio de la pestaña» (el permiso de captura de pantalla es opcional y solo se pide ahí). En Ajustes
puedes dejar el selector como método fijo.

Con ese clic se activan a la vez: los subtítulos de Meet (en español), el audio (voces + tu micrófono) y el panel lateral.

## Qué hace

- **Subtítulos**: los activa si no lo están (sin apagarlos por error), los lee con el nombre de quien habla y los manda al
  CRM al terminar. Si no logra activarlos, o no llega ninguno en ~90 s, **avisa** en el panel.
- **Audio**: voces de la reunión + tu micrófono, **solo mientras no estás silenciado en Meet**. Se corta en partes de
  10 minutos que se suben solas (con reintentos), así que una pestaña cerrada solo cuesta la parte en curso. El CRM lo
  transcribe con Whisper y lo suma a la reunión.
- **Reunión del CRM**: antes de grabar puedes elegir a cuál reunión agendada pertenece (lista de hoy y próximas, con buscador y
  pestaña «Todas»). Cada grabación queda como una sección aparte, con su fecha y hora, dentro de esa reunión; no se mezclan.
- **Grabar pantalla**: botón en el panel y en el ícono. Graba la pantalla, una ventana o una pestaña (con el audio de lo que suena y,
  si quieres, tu micrófono) y la guarda **en tu computador**, en la carpeta que elijas; no se sube al CRM.
- **Panel lateral**: subtítulos en vivo, estado del audio y del micrófono, avisos de error, **Pausar / Reanudar**
  (en pausa no se guarda ni audio ni subtítulos, y lo dicho durante la pausa no aparece al reanudar), **Detener y
  enviar** .
- **Ajustes** (en el panel): elegir **qué micrófono** se graba (con barra de nivel para comprobarlo; cambia en vivo si ya
  grabas, y si el elegido se desconecta usa el predeterminado), idioma de los subtítulos, esconder la franja de Meet y abrir
  la ventana sola al entrar a una reunión.
- **Botón con el logo del CRM** en la pantalla de la reunión (abajo a la izquierda): abre el panel cuando quieras, aunque no
  estés grabando. Chrome no permite abrir el panel sin un clic, por eso el botón; para que la **ventana separada** aparezca sola
  al entrar, activa «Abrir la ventana sola…» en el ícono o en los Ajustes.
- Muestra **a qué organización** se está enviando la reunión (y su nombre) arriba del panel.
- **Permiso del micrófono**: si falta, el panel muestra un aviso con el botón «Permitir micrófono» y Chrome pide el permiso
  solo («quiere usar tu micrófono»), sin tener que buscar ningún botón. El audio de la reunión empieza a grabarse igual
  mientras tanto, y tu voz se suma apenas la permites.
- La franja vacía de subtítulos de Meet se esconde aunque nadie esté hablando todavía.
- **Diagnóstico** (Ajustes del panel): registro de lo que hizo la extensión (audio, subtítulos, pantalla de Meet) con un botón
  para copiarlo; sirve para ver por qué algo no arrancó.
- Funciona al entrar a una reunión desde la pantalla de inicio de Meet, sin recargar la pestaña.
- **Varias grabaciones por reunión**: «Detener y enviar» cierra esa grabación y el panel deja **grabar otra** en la misma sala
  (primero el cliente, después el equipo). Cada una es una reunión separada en el CRM (requiere el CRM desplegado con la
  columna `extensionRecordingId`; con un CRM anterior se mezclan en una sola).
- Al terminar muestra un resumen (duración, líneas, partes de audio) y pregunta **¿a qué cliente fue esta reunión?** ahí mismo,
  en el panel, para vincularla a una ficha de Seguimiento.
- **Un solo paso inicial**: «Iniciar sesión y permitir el micrófono» pide el permiso de Chrome y abre el CRM.
- **Tu micrófono se corta al instante** cuando te silencias en Meet (silencio total, menos de ¼ de segundo); no baja el volumen.
- Si recargas la extensión con una pestaña de Meet abierta, el script viejo se apaga solo sin errores (recarga la pestaña).
- Es **prueba de fallos**: si falla el audio siguen los subtítulos, y al revés.

## Archivos

| Archivo | Qué hace |
|---|---|
| `manifest.json` | Permisos y piezas (MV3). Chrome 116 o más. |
| `background.js` | Coordinador: tabCapture, estado en vivo, ventana separada. |
| `offscreen.js` | Graba el audio en partes y las sube con reintentos. |
| `content.js` | Lee los subtítulos de la pestaña de Meet y detecta el fin de la reunión. |
| `captions-dom.js` | Activa los subtítulos de forma segura y esconde su franja. |
| `sidepanel.html/js` | El panel (se abre con el ícono): sesión, organización, nombre, «Grabar», subtítulos en vivo y ajustes. También como ventana separada. |
| `permissions.html/js` | Única página que pide el micrófono (una vez, en una pestaña normal: el panel lateral pierde el foco y descartaba el aviso). |
| `authorize-bridge.js` | Guarda tu sesión del CRM al conectarte. |

## Permisos (y por qué)

- `tabCapture` + `offscreen`: grabar el audio de la pestaña de la reunión (solo al pulsar «Grabar»).
- `activeTab`: Chrome exige que el usuario invoque la extensión para capturar una pestaña.
- `sidePanel`: el panel con los subtítulos en vivo.
- `storage`: recordar tu sesión del CRM, la organización elegida y el estado en vivo.
- Hosts: `meet.google.com` (leer los subtítulos) y el CRM (enviarlos y conectarte).

La publicación en la Chrome Web Store está preparada en `STORE-LISTING.md`.
