# WhatsApp ProShop — Inbox

Bandeja de conversaciones de WhatsApp Business para un equipo — sin bots, sin IA. Varias
personas atienden el mismo número desde un solo panel, en tiempo real.

## Desarrollo local

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).

## ✅ Checklist antes de usar en producción con clientes reales

Estos tres puntos son los que de verdad pueden morder si se saltan:

### 1. `WHATSAPP_APP_SECRET` — obligatoria

Sin ella, el webhook **acepta cualquier POST sin verificar que venga de Meta** (cualquiera
podría inyectar mensajes falsos). En producción, si falta, el webhook **rechaza todo** en vez
de aceptar de forma insegura — así que si dejaste de recibir mensajes, revisa esto primero.

Se saca del dashboard de tu app en [developers.facebook.com](https://developers.facebook.com/).

### 2. Almacenamiento de media — necesita ser persistente

Las fotos/videos/audios/documentos que llegan o se envían se guardan en algún lado. Hay dos
modos:

- **Sin `S3_BUCKET` configurado**: se guardan en disco local (`/public/media` dentro del
  contenedor). **Si ese path no está en un volumen persistente de Coolify, se pierde TODO en
  el próximo redeploy o reinicio.** Solo usar esto si configuraste el volumen.
- **Con `S3_BUCKET` + `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY` + `S3_ENDPOINT`
  configurados**: sube ahí (persiste sin depender de volúmenes del contenedor). Funciona con
  el MinIO que trae Coolify, Cloudflare R2, DigitalOcean Spaces, AWS S3, etc. **Esta es la
  opción recomendada para producción.**

### 3. Backups de la base de datos

Postgres no se respalda solo. En Coolify: entra al recurso de la base de datos → pestaña
**Backups** → activa el backup programado (Coolify lo sube a S3 automáticamente). Si prefieres
manejarlo tú, hay un script:

```bash
DATABASE_URL="postgresql://..." npm run db:backup
```

## Coexistence — usar el número que ya está en el celular

Con Coexistence, un negocio conecta su número al panel **sin dejar de usar la app de WhatsApp
Business en el celular**: el equipo puede responder desde ambos lados, y los mensajes se
sincronizan (incluye historial de conversaciones previas). Esto requiere el flujo de
**Embedded Signup** de Meta en vez de pegar credenciales a mano.

### Configuración en Meta (una sola vez, por app de Meta)

1. En [developers.facebook.com](https://developers.facebook.com/), entra a tu app → **WhatsApp**
   → **Configuración de la API embebida (Embedded Signup)**.
2. Crea una configuración nueva (`Configuration`) y **activa la opción de Coexistence**
   ("permitir vincular números que ya usan la app de WhatsApp Business"). Guarda el
   `config_id` que te da — es el que va en `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`.
3. Copia el **App ID** de tu app de Meta (arriba a la izquierda del dashboard) →
   `NEXT_PUBLIC_WHATSAPP_APP_ID`.
4. En **Configuración básica** de la app, copia el **App Secret** → `WHATSAPP_APP_SECRET`
   (esta es la misma que ya usa el webhook, no hay que sacarla dos veces).
5. Agrega el dominio de tu panel (`https://tu-dominio`) a **Dominios permitidos de la app** y a
   los orígenes válidos de OAuth, si Meta te lo pide.
6. Estas dos variables (`NEXT_PUBLIC_WHATSAPP_APP_ID`, `NEXT_PUBLIC_WHATSAPP_CONFIG_ID`) **no son
   secretas** — van al bundle del navegador, por eso el prefijo `NEXT_PUBLIC_`. Se pueden ver en
   el código fuente del cliente, es normal.

### Uso desde el panel

En **WhatsApp → Conectar**, el botón "Conectar con Coexistence" abre el diálogo de Facebook
Login for Business, el dueño de la organización inicia sesión con su cuenta de Meta Business
vinculada al número, y el panel recibe automáticamente `waba_id` y `phone_number_id`. Después
de conectar, Meta empieza a mandar el historial de conversaciones previas por el webhook — el
panel muestra "Importando historial…" mientras dura (puede tardar varios minutos).

Si no quieres usar Coexistence (por ejemplo, un número dedicado solo para el panel, sin app de
celular), la opción "conectar a mano con credenciales de la Cloud API" sigue disponible debajo,
sin necesidad de configurar estas variables.

## Variables de entorno

Ver [`.env.example`](.env.example) — cada variable tiene un comentario explicando para qué
sirve y qué pasa si falta.

## Deploy en Coolify

1. **Postgres**: New Resource → Database → PostgreSQL. Activa backups programados.
2. **(Opcional pero recomendado) MinIO/S3**: New Resource → Storage, o usa un bucket externo
   (R2, Spaces, S3).
3. **App**: New Resource → Application → Public Repository → build pack **Dockerfile**
   (el `Dockerfile` del repo ya está listo), puerto `3000`.
4. Configura todas las variables de `.env.example` en el servicio de la app. Las que empiezan
   con `NEXT_PUBLIC_` (Coexistence) se hornean en el bundle **al momento del build**, así que
   en Coolify marca "Available at Buildtime" para `NEXT_PUBLIC_WHATSAPP_APP_ID` y
   `NEXT_PUBLIC_WHATSAPP_CONFIG_ID` — si no, quedan vacías aunque las hayas puesto.
5. Corre las migraciones una vez desplegado:
   ```bash
   npx prisma migrate deploy
   ```
6. Configura el webhook en Meta apuntando a
   `https://tu-dominio/api/webhooks/whatsapp`, con el mismo token de
   `WHATSAPP_VERIFY_TOKEN`.

No hace falta Redis ni un worker aparte — el webhook procesa todo directamente.
