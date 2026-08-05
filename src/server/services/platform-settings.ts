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

async function loadFromDb(): Promise<PlatformSettings> {
  const row = await prisma.platformSetting.findUnique({ where: { id: SINGLETON_ID } });

  // La web gana si está configurada; si no, se cae a las variables de
  // entorno — así los despliegues que ya las tenían ahí no se rompen.
  return {
    whatsappAppId: row?.whatsappAppId || process.env.WHATSAPP_APP_ID || null,
    whatsappAppSecret: row?.whatsappAppSecret
      ? decrypt(row.whatsappAppSecret)
      : process.env.WHATSAPP_APP_SECRET || null,
    whatsappConfigId: row?.whatsappConfigId || process.env.WHATSAPP_CONFIG_ID || null,
    whatsappVerifyToken: row?.whatsappVerifyToken || process.env.WHATSAPP_VERIFY_TOKEN || null,
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
