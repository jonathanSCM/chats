/**
 * Marca propia por organización. Lo que se muestra depende de dos cosas: que el superadmin haya
 * habilitado `canCustomizeBrand` para esa organización y que ella haya cargado algo. Si el plan se
 * apaga, la marca propia deja de verse pero NO se borra (al reactivarlo vuelve).
 */

import { pickBrandSource } from "@/lib/org-hierarchy";

export const PLATFORM_BRAND_NAME = "WhatsApp ProShop";
/** Nombre corto que usa el bot en sus saludos cuando la organización no puso uno propio. */
export const PLATFORM_SHORT_NAME = "ProShop";

export const MAX_LOGO_BYTES = 400 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

export interface BrandSource {
  canCustomizeBrand: boolean;
  brandName: string | null;
  brandColor: string | null;
  assistantName: string | null;
  brandLogoVersion: number;
}

export interface ResolvedBrand {
  /** true cuando hay marca propia en uso. */
  custom: boolean;
  /** Nombre propio, o null para usar el de la plataforma. */
  name: string | null;
  color: string | null;
  assistantName: string | null;
  /** Ruta pública del logo propio (con versión para romper la caché), o null. */
  logoPath: string | null;
}

export function resolveBrand(org: BrandSource & { id: string }): ResolvedBrand {
  if (!org.canCustomizeBrand) return { custom: false, name: null, color: null, assistantName: null, logoPath: null };
  const logoPath = org.brandLogoVersion > 0 ? `/api/brand-logo/${org.id}?v=${org.brandLogoVersion}` : null;
  const name = org.brandName?.trim() || null;
  const color = org.brandColor && isUsableBrandColor(org.brandColor) ? org.brandColor : null;
  const assistantName = org.assistantName?.trim() || null;
  return { custom: Boolean(name || color || assistantName || logoPath), name, color, assistantName, logoPath };
}

/** Campos de la organización padre que hacen falta para heredar su marca. */
export const BRAND_PARENT_SELECT = {
  id: true,
  canCustomizeBrand: true,
  brandName: true,
  brandColor: true,
  assistantName: true,
  brandLogoVersion: true,
} as const;

/**
 * Marca de una organización teniendo en cuenta a su padre: una suborganización usa su propia marca
 * si su plan la permite y cargó algo; si no, hereda la del padre.
 */
export function resolveOrgBrand(
  org: BrandSource & { id: string },
  parent: (BrandSource & { id: string }) | null | undefined,
): ResolvedBrand {
  return pickBrandSource(resolveBrand(org), parent ? resolveBrand(parent) : null);
}

/** Nombre con el que se presenta el asistente: el propio, o "Asistente de {marca}". */
export function assistantDisplayName(brand: ResolvedBrand, fallbackOrgName: string): string {
  return brand.assistantName ?? `Asistente de ${brand.name ?? fallbackOrgName}`;
}

/** Cómo dice el bot de WhatsApp que se llama su empresa (para el saludo). */
export function botCompanyName(brand: ResolvedBrand): string {
  return brand.name ?? PLATFORM_SHORT_NAME;
}

// ── Color ──────────────────────────────────────────────────────────────────

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX.test(value);
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Contraste del color contra blanco (el texto de los botones de acento es blanco). 1 a 21. */
export function contrastWithWhite(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return 1.05 / (luminance + 0.05);
}

/** Un color de acento sirve si el texto blanco encima se lee (mínimo 3:1, el umbral de texto grande/botones). */
export function isUsableBrandColor(hex: string): boolean {
  return isHexColor(hex) && contrastWithWhite(hex) >= 3;
}

/** Variables CSS que reemplazan el acento de la app. */
export function accentStyle(color: string | null): Record<string, string> | undefined {
  if (!color) return undefined;
  return {
    "--accent": color,
    "--accent-ink": "#ffffff",
    "--accent-dim": `color-mix(in srgb, ${color} 75%, white)`,
  };
}

// ── Imagen ─────────────────────────────────────────────────────────────────

/** Tipo real de la imagen según sus primeros bytes (no se confía en el nombre ni en el tipo que manda el navegador). */
export function detectLogoType(bytes: Uint8Array): LogoType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
