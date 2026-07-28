# Zócalo Inbox

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

## Variables de entorno

Ver [`.env.example`](.env.example) — cada variable tiene un comentario explicando para qué
sirve y qué pasa si falta.

## Deploy en Coolify

1. **Postgres**: New Resource → Database → PostgreSQL. Activa backups programados.
2. **(Opcional pero recomendado) MinIO/S3**: New Resource → Storage, o usa un bucket externo
   (R2, Spaces, S3).
3. **App**: New Resource → Application → Public Repository → build pack **Dockerfile**
   (el `Dockerfile` del repo ya está listo), puerto `3000`.
4. Configura todas las variables de `.env.example` en el servicio de la app.
5. Corre las migraciones una vez desplegado:
   ```bash
   npx prisma migrate deploy
   ```
6. Configura el webhook en Meta apuntando a
   `https://tu-dominio/api/webhooks/whatsapp`, con el mismo token de
   `WHATSAPP_VERIFY_TOKEN`.

No hace falta Redis ni un worker aparte — el webhook procesa todo directamente.
