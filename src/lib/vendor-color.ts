// Color determinístico por vendedor (mismo userId siempre da el mismo
// color), para distinguir de un vistazo quién atiende cada chat.
const PALETTE = [
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

export function vendorColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
