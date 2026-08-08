import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";

const SINGLETON_ID = "singleton";

export interface PlatformSettings {
  whatsappAppId: string | null;
  whatsappAppSecret: string | null;
  whatsappConfigId: string | null;
  whatsappVerifyToken: string | null;
}

// Se cachea en memoria un rato corto: esto se consulta en cada webhook de
// WhatsApp (verificación de firma), así que ir a la base en cada request
// sería un costo innecesario. 30s es suficiente margen para que un cambio
// hecho desde /admin/settings se sienta "casi al instante" sin machacar la DB.
let cache: PlatformSettings | null = null;
let cacheAt = 0;
const CACHE_TTL_MS = 30_000;

// El SDK de Facebook rechaza en silencio (console.warn, sin error) un App ID
// con espacios de más — nunca guarda el client ID y FB.login() falla después
// como si FB.init() nunca se hubiera llamado. Se recorta acá también por si
// las variables de entorno (Coolify) traen espacios de un copy-paste.
function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function fromEnv(): PlatformSettings {
  return {
    whatsappAppId: trimOrNull(process.env.WHATSAPP_APP_ID),
    whatsappAppSecret: trimOrNull(process.env.WHATSAPP_APP_SECRET),
    whatsappConfigId: trimOrNull(process.env.WHATSAPP_CONFIG_ID),
    whatsappVerifyToken: trimOrNull(process.env.WHATSAPP_VERIFY_TOKEN),
  };
}

async function loadFromDb(): Promise<PlatformSettings> {
  // Esto corre en cada webhook de WhatsApp y en /dashboard/whatsapp — si la
  // tabla no existe todavía (falta la migración) o la base está caída, un
  // error acá no debe tumbar el webhook ni la página: se cae a las
  // variables de entorno como si la fila no existiera.
  let row;
  try {
    row = await prisma.platformSetting.findUnique({ where: { id: SINGLETON_ID } });
  } catch (error) {
    console.error("[platform-settings] No se pudo leer de la base, usando variables de entorno:", error);
    return fromEnv();
  }

  // La web gana si está configurada; si no, se cae a las variables de
  // entorno — así los despliegues que ya las tenían ahí no se rompen.
  return {
    whatsappAppId: trimOrNull(row?.whatsappAppId) || trimOrNull(process.env.WHATSAPP_APP_ID),
    whatsappAppSecret: row?.whatsappAppSecret
      ? decrypt(row.whatsappAppSecret).trim()
      : trimOrNull(process.env.WHATSAPP_APP_SECRET),
    whatsappConfigId: trimOrNull(row?.whatsappConfigId) || trimOrNull(process.env.WHATSAPP_CONFIG_ID),
    whatsappVerifyToken:
      trimOrNull(row?.whatsappVerifyToken) || trimOrNull(process.env.WHATSAPP_VERIFY_TOKEN),
  };
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  cache = await loadFromDb();
  cacheAt = now;
  return cache;
}

// Se llama después de guardar cambios desde /admin/settings, para que el
// próximo request ya vea el valor nuevo en vez de esperar a que expire el cache.
export function invalidatePlatformSettingsCache(): void {
  cache = null;
}
