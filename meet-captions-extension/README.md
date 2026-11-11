# ProShop CRM — Asistente de reuniones de Meet (extensión de Chrome, v2.0.0)

Graba **los subtítulos y el audio** de tus reuniones de Google Meet y los guarda en tu CRM, con un **panel lateral** que
muestra los subtítulos en vivo (y se puede separar en su propia ventana). Corre en tu navegador, como un participante
más: no hay bot, nadie tiene que admitirlo.

## Cómo probarla (modo desarrollador)

1. Abre `chrome://extensions` y activa **Modo de desarrollador** (arriba a la derecha).
2. **Cargar descomprimida** → elige esta carpeta (`meet-captions-extension`).
3. Fija el ícono (el rompecabezas de la barra → alfiler).
4. Abre el ícono → **Conectar con el CRM** (usa tu sesión; no hay que pegar tokens).
5. Una sola vez, **Activar micrófono** (Chrome pide el permiso en una pestaña).
6. Entra a una reunión de Meet → ícono → (nombre y organización si quieres) → **Grabar esta reunión**.

Con ese clic se activan a la vez: los subtítulos de Meet (en español), el audio (voces + tu micrófono) y el panel lateral.

## Qué hace

- **Subtítulos**: los activa si no lo están (sin apagarlos por error), los lee con el nombre de quien habla y los manda al
  CRM al terminar. Si no logra activarlos, o no llega ninguno en ~90 s, **avisa** en el panel.
- **Audio**: voces de la reunión + tu micrófono, **solo mientras no estás silenciado en Meet**. Se corta en partes de
  10 minutos que se suben solas (con reintentos), así que una pestaña cerrada solo cuesta la parte en curso. El CRM lo
  transcribe con Whisper y lo suma a la reunión.
- **Panel lateral**: subtítulos en vivo, estado del audio y del micrófono, avisos de error, **Pausar / Reanudar**
  (en pausa no se guarda ni audio ni subtítulos, y lo dicho durante la pausa no aparece al reanudar), **Detener y
  enviar** y **Separar en ventana**.
- **Ajustes** (en el panel): elegir **qué micrófono** se graba (con barra de nivel para comprobarlo; cambia en vivo si ya
  grabas, y si el elegido se desconecta usa el predeterminado), idioma de los subtítulos, esconder la franja de Meet y abrir
  la ventana sola al entrar a una reunión.
- **Botón verde «PS»** en la pantalla de la reunión (abajo a la izquierda): abre el panel cuando quieras, aunque no estés
  grabando. Chrome no permite abrir el panel sin un clic, por eso el botón; para que la **ventana separada** aparezca sola
  al entrar, activa «Abrir la ventana sola…» en el ícono o en los Ajustes.
- La franja vacía de subtítulos de Meet se esconde aunque nadie esté hablando todavía.
- Funciona al entrar a una reunión desde la pantalla de inicio de Meet, sin recargar la pestaña.
- Al terminar (o al detener) pregunta **¿a qué cliente fue esta reunión?** para vincularla a una ficha de Seguimiento.
- Es **prueba de fallos**: si falla el audio siguen los subtítulos, y al revés.

## Archivos

| Archivo | Qué hace |
|---|---|
| `manifest.json` | Permisos y piezas (MV3). Chrome 116 o más. |
| `background.js` | Coordinador: tabCapture, estado en vivo, ventana separada. |
| `offscreen.js` | Graba el audio en partes y las sube con reintentos. |
| `content.js` | Lee los subtítulos de la pestaña de Meet y detecta el fin de la reunión. |
| `captions-dom.js` | Activa los subtítulos de forma segura y esconde su franja. |
| `popup.html/js` | Ícono: conexión, organización, nombre y «Grabar». |
| `sidepanel.html/js` | Panel lateral / ventana separada. |
| `permissions.html/js` | Concede el micrófono una vez (el popup se cierra al perder el foco). |
| `authorize-bridge.js` | Guarda tu sesión del CRM al conectarte. |

## Permisos (y por qué)

- `tabCapture` + `offscreen`: grabar el audio de la pestaña de la reunión (solo al pulsar «Grabar»).
- `activeTab`: Chrome exige que el usuario invoque la extensión para capturar una pestaña.
- `sidePanel`: el panel con los subtítulos en vivo.
- `storage`: recordar tu sesión del CRM, la organización elegida y el estado en vivo.
- Hosts: `meet.google.com` (leer los subtítulos) y el CRM (enviarlos y conectarte).

La publicación en la Chrome Web Store está preparada en `STORE-LISTING.md`.
