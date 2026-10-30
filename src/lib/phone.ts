import { isBsuid } from "@/lib/whatsapp-recipient";

/**
 * Enlace para llamar con un toque (`tel:`). Los clientes con nombre de usuario de WhatsApp pueden no tener
 * número visible (su identificador es un BSUID): en ese caso no hay a quién llamar y devuelve null.
 */
export function phoneHref(identifier: string | null | undefined): string | null {
  const raw = identifier?.trim();
  if (!raw || isBsuid(raw)) return null;
  const digits = raw.replace(/[^\d]/g, "");
  return digits.length >= 6 ? `tel:+${digits}` : null;
}

/** Número para mostrar: "+51987654321" si es un teléfono; una explicación si es un usuario sin número; el texto tal cual si no es ninguno. */
export function formatPhoneDisplay(identifier: string): string {
  if (isBsuid(identifier)) return "Usuario de WhatsApp (sin número visible)";
  const digits = identifier.replace(/[^\d]/g, "");
  return digits.length >= 6 ? `+${digits}` : identifier;
}
