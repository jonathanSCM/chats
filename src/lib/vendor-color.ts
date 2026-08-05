// Color determinístico por vendedor (mismo userId siempre da el mismo
// color), para distinguir de un vistazo quién atiende cada chat. También
// sirve de paleta de elección rápida cuando alguien quiere fijar su color
// a mano (ver VENDOR_COLOR_PALETTE más abajo).
export const VENDOR_COLOR_PALETTE = [
  "#e11d48", // rose
  "#ea580c", // orange
  "#ca8a04", // yellow
  "#65a30d", // lime
  "#059669", // emerald
  "#0891b2", // cyan
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
  "#0d9488", // teal
];

function hashColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return VENDOR_COLOR_PALETTE[Math.abs(hash) % VENDOR_COLOR_PALETTE.length];
}

// Si el usuario eligió un color (User.color), se respeta; si no, se deriva
// uno determinístico del id para que nadie tenga que elegir uno antes de
// que exista esa opción.
export function vendorColor(userId: string, customColor?: string | null): string {
  return customColor || hashColor(userId);
}
