# Ficha para la Chrome Web Store — ProShop CRM · Asistente de reuniones de Meet

Todo lo que pide el panel de desarrollador, listo para copiar. Cuenta de desarrollador: pago único de US$5.

## Datos básicos

- **Nombre**: ProShop CRM — Asistente de reuniones de Meet
- **Categoría**: Productividad
- **Idioma**: Español
- **Resumen corto (máx. 132)**: Graba los subtítulos y el audio de tus reuniones de Google Meet y los guarda en tu CRM, con subtítulos en vivo en un panel.
- **URL de la política de privacidad**: https://chats.proshop.lat/privacy (ya incluye la sección de la extensión)
- **Sitio web / soporte**: https://chats.proshop.lat — proshop.soporte@gmail.com

## Descripción larga

Convierte tus reuniones de Google Meet en información útil para tu CRM, sin bots ni invitados extra.

Pulsa «Grabar esta reunión» y la extensión, desde tu propio navegador:
• Guarda los subtítulos de la reunión con el nombre de quien habla.
• Graba el audio (las voces de los demás y tu micrófono, solo cuando no estás silenciado) y lo transcribe.
• Te muestra los subtítulos en vivo en un panel lateral, que puedes separar en su propia ventana.
• Va guardando los subtítulos en tu CRM mientras grabas, y si algo se corta (por ejemplo, se cierra el navegador) te ofrece recuperar lo que faltó.
• Al terminar, la reunión queda en tu CRM ProShop con su transcripción y resumen.

Pensada para equipos comerciales: la información de cada reunión queda en tu CRM, sin tener que tomar notas a mano.

Requiere una cuenta de CRM ProShop. Nunca empieza a grabar sola: solo cuando tú lo pides, y muestra un indicador mientras graba. Quien graba es responsable de avisar a los participantes y de contar con su consentimiento cuando la ley lo exija.

## Propósito único

Grabar y guardar en el CRM ProShop del usuario los subtítulos y el audio de las reuniones de Google Meet que el usuario decide grabar.

## Justificación de permisos

| Permiso | Justificación |
|---|---|
| `tabCapture` | Capturar el audio de la pestaña de la reunión de Meet, solo cuando el usuario pulsa «Grabar esta reunión». |
| `offscreen` | Mantener la grabación de audio (necesita APIs de audio que el service worker no tiene). |
| `activeTab` | Chrome exige que el usuario invoque la extensión para poder capturar el audio de la pestaña. |
| `sidePanel` | Mostrar en un panel lateral los subtítulos en vivo y el estado de la grabación. |
| `desktopCapture` (opcional) | Plan B para capturar el audio: si Chrome no permite la captura automática de la pestaña, la persona elige la pestaña de Meet en el selector de Chrome. Solo se pide si ella decide usarlo. |
| `storage` | Guardar la sesión del CRM, la organización elegida y el estado de la grabación. |
| Host `https://meet.google.com/*` | Leer los subtítulos de la reunión y detectar cuándo termina. |
| Host `https://chats.proshop.lat/*` | Conectar con la cuenta del CRM y enviar los subtítulos y el audio. |

## Prácticas de privacidad (formulario)

- **¿Recopila datos de usuario?** Sí:
  - *Información de comunicaciones personales / contenido del sitio web*: subtítulos y audio de la reunión que el usuario decide grabar.
  - *Información de autenticación*: token de sesión del CRM.
- **No** vende datos, **no** los usa para publicidad ni para decidir créditos, **no** los transfiere salvo para operar la función (CRM y su proveedor de transcripción/IA).
- **Código remoto**: no usa.
- **Divulgación y consentimiento dentro de la extensión**: la primera vez, antes de pedir sesión o micrófono, el panel muestra qué se graba, a dónde va (CRM y su proveedor de IA), qué no hace y cómo controlarlo, y exige marcar una casilla («debo avisar a los participantes») para continuar. Se vuelve a mostrar si cambia el texto.
- Marcar las tres certificaciones de «Uso limitado».

## Imágenes que hay que subir

- Ícono 128×128: ya incluido en `icons/` (es el logo del CRM, el mismo de la app).
- Al menos 1 captura de 1280×800 (mejor 3–5): el panel lateral con subtítulos en vivo, el ícono con «Grabar», la ficha del CRM con la transcripción.
- Imagen promocional pequeña 440×280 (opcional pero recomendada).

## Antes de enviarla

1. Probarla bien con reuniones reales (ver `README.md`): subtítulos, audio, silencio del micrófono, detener y enviar, ventana separada.
2. Subir a la tienda el ZIP de esta carpeta (sin `README.md` ni `STORE-LISTING.md`).
3. La revisión de Google suele tardar de unos días a un par de semanas; el uso de `tabCapture` y de permisos sobre `meet.google.com` puede pedir una explicación adicional (usar la justificación de arriba).
4. Cada versión nueva se sube igual y se revisa de nuevo.
