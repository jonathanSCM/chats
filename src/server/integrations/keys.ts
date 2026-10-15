import { createHash, randomBytes } from "node:crypto";

export const INTEGRATION_SCOPES = ["read", "write:activities"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

const KEY_PREFIX = "pk_live_";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/**
 * Clave en claro (se muestra UNA vez), su hash (lo único que se guarda) y los
 * primeros caracteres visibles para reconocerla en la pantalla.
 */
export function generateApiKey(): { key: string; keyHash: string; prefix: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, keyHash: hashApiKey(key), prefix: key.slice(0, KEY_PREFIX.length + 4) };
}

export function isIntegrationScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value);
}
