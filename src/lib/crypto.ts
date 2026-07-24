import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM para cifrar credenciales sensibles (tokens de WhatsApp) en reposo.
// APP_ENCRYPTION_KEY debe ser 32 bytes en base64 (generar con: openssl rand -base64 32).
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (!key) throw new Error("APP_ENCRYPTION_KEY no está configurada");
  const buf = Buffer.from(key, "base64");
  if (buf.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY debe decodificar a 32 bytes");
  }
  return buf;
}

export function encrypt(plainText: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
