import { randomBytes, createHash } from "node:crypto";

// Tokens de un solo uso (reset de password, verificación de email, invites):
// se genera un valor aleatorio, se envía tal cual por correo/link, y solo su
// hash se guarda en la base de datos — así una fuga de la DB no expone
// tokens utilizables.

export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
