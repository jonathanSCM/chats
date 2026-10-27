// Código estándar de Google Meet: 3 letras, 4 letras, 3 letras (abc-defg-hij).
const STANDARD_CODE = /(?:^|[/?=])([a-z]{3}-[a-z]{4}-[a-z]{3})(?=$|[/?&#])/i;
// Segmentos de ruta de Meet que NO son el código de la reunión.
const NON_CODE_SEGMENTS = new Set(["meet", "lookup", "_meet", "landing"]);

/**
 * Código de la reunión a partir del link de Meet. Acepta las formas que
 * genera Google: `meet.google.com/abc-defg-hij`, `meet.google.com/meet/abc-defg-hij`
 * y `meet.google.com/lookup/...`. Antes se tomaba lo primero después de
 * "meet.google.com/", y en `.../meet/abc-defg-hij` eso devolvía "meet": el bot
 * se pedía para una reunión inexistente y fallaba.
 */
export function extractMeetCode(rawUrl: string): string | null {
  let meetingUrl = rawUrl.trim();
  // Enlaces envueltos (google.com/url?q=https%3A%2F%2Fmeet.google.com%2F...) o con el texto alrededor.
  if (/%2F/i.test(meetingUrl)) {
    try {
      meetingUrl = decodeURIComponent(meetingUrl);
    } catch {
      /* se usa tal cual */
    }
  }
  // Solo el código, sin link: "abc-defg-hij".
  const bare = meetingUrl.match(/^([a-z]{3}-[a-z]{4}-[a-z]{3})$/i);
  if (bare) return bare[1].toLowerCase();
  // Enlace corto de Google: g.co/meet/apodo
  const short = meetingUrl.match(/g\.co\/meet\/([a-z0-9-]+)/i);
  if (short) return short[1].toLowerCase();
  if (!/meet\.google\.com/i.test(meetingUrl)) return null;

  const standard = meetingUrl.match(STANDARD_CODE);
  if (standard) return standard[1].toLowerCase();

  // Códigos con apodo (poco comunes): primer segmento de ruta que no sea una palabra reservada.
  const path = meetingUrl.split(/meet\.google\.com\//i)[1] ?? "";
  const segment = path
    .split(/[?#]/)[0]
    .split("/")
    .find((s) => /^[a-z0-9-]+$/i.test(s) && !NON_CODE_SEGMENTS.has(s.toLowerCase()));
  return segment ? segment.toLowerCase() : null;
}

/** Link completo de Meet a partir de lo que pegó la persona (código suelto, sin https, etc.). */
export function normalizeMeetUrl(input: string | null | undefined): string | null {
  const value = input?.trim();
  if (!value) return null;
  const code = extractMeetCode(value);
  if (!code) return value; // no es de Meet (Zoom u otro): se guarda como vino
  return `https://meet.google.com/${code}`;
}
