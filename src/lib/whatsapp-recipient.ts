// Desde 2026 WhatsApp permite nombres de usuario: esos clientes llegan identificados por un
// BSUID (business-scoped user ID, p. ej. "PE.13491208655302741918") en vez de un teléfono.
const BSUID = /^[A-Za-z]{2}\.[A-Za-z0-9]+$/;

export function isBsuid(identifier: string): boolean {
  return BSUID.test(identifier.trim());
}

/** Identificador del remitente: el teléfono si Meta lo manda; si no, el BSUID. */
export function senderIdentifier(message: { from?: string; from_user_id?: string }): string | null {
  return message.from?.trim() || message.from_user_id?.trim() || null;
}

/** Campo del cuerpo de /messages para escribirle a este cliente: `to` (teléfono) o `recipient` (BSUID). */
export function recipientField(identifier: string): { to: string } | { recipient: string } {
  return isBsuid(identifier) ? { recipient: identifier.trim() } : { to: identifier };
}
