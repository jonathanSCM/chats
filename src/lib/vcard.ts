import { isBsuid } from "@/lib/whatsapp-recipient";

/**
 * Tarjeta de contacto (vCard 3.0, archivo .vcf). El teléfono la abre con un toque y ofrece guardar el
 * contacto en la agenda (iPhone y Android). WhatsApp no deja escribir en la agenda del celular por API,
 * así que esta es la forma de pasar un contacto del CRM al teléfono.
 */

export interface VCardContact {
  fullName: string | null;
  phone: string;
  email?: string | null;
  jobTitle?: string | null;
  company?: string | null;
  city?: string | null;
  country?: string | null;
}

/** Escapa lo que el formato trata como separador: \ ; , y los saltos de línea. */
function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

export function buildVCard(contact: VCardContact): string {
  const name = contact.fullName?.trim() || contact.phone;
  const parts = name.split(/\s+/);
  const family = parts.length > 1 ? parts.slice(1).join(" ") : "";
  const given = parts[0] ?? "";

  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`, `N:${esc(family)};${esc(given)};;;`];

  // Un usuario de WhatsApp sin número visible no tiene teléfono que guardar.
  const digits = contact.phone.replace(/[^\d]/g, "");
  if (!isBsuid(contact.phone) && digits.length >= 6) lines.push(`TEL;TYPE=CELL:+${digits}`);
  if (contact.email?.trim()) lines.push(`EMAIL;TYPE=INTERNET:${esc(contact.email.trim())}`);
  if (contact.company?.trim()) lines.push(`ORG:${esc(contact.company.trim())}`);
  if (contact.jobTitle?.trim()) lines.push(`TITLE:${esc(contact.jobTitle.trim())}`);
  const city = contact.city?.trim() ?? "";
  const country = contact.country?.trim() ?? "";
  if (city || country) lines.push(`ADR;TYPE=WORK:;;;${esc(city)};;;${esc(country)}`);

  lines.push("END:VCARD");
  // El formato pide saltos de línea CRLF.
  return lines.join("\r\n") + "\r\n";
}

function slug(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/** Nombre de archivo seguro para la descarga: sin tildes ni símbolos; si el nombre no deja nada, usa el teléfono. */
export function vcardFileName(contact: Pick<VCardContact, "fullName" | "phone">): string {
  const base = slug(contact.fullName ?? "") || slug(contact.phone);
  return `${base || "contacto"}.vcf`;
}
