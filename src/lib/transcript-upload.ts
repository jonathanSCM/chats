/**
 * Transcripciones de reuniones externas (Zoom, Teams, Meet, otra herramienta) que se suben a la ficha de un cliente
 * como archivo o pegadas como texto. Aquí viven las partes puras: limpiar el texto y decidir qué se "comprime" en una
 * etiqueta al pegar.
 */

/** Un texto pegado más largo que esto se guarda como etiqueta («Texto pegado · N caracteres») y no llena el cuadro. */
export const LONG_PASTE_CHARS = 1200;
export const TRANSCRIPT_MIN_CHARS = 40;
export const TRANSCRIPT_MAX_CHARS = 100_000;

const CUE_TIME = /^\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}.*$/;
const BARE_NUMBER = /^\s*\d+\s*$/;

/**
 * Deja solo lo hablado: quita el encabezado WEBVTT, los números de bloque y las líneas de tiempo de los subtítulos
 * (.vtt/.srt) y las etiquetas HTML simples, y compacta las líneas en blanco. Un texto normal queda igual.
 */
export function cleanTranscriptText(raw: string): string {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const isSubtitleFile = lines.some((l) => CUE_TIME.test(l)) || /^\s*WEBVTT/.test(lines[0] ?? "");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isSubtitleFile) {
      if (/^\s*(WEBVTT|NOTE|STYLE|Kind:|Language:)/.test(line)) continue;
      if (CUE_TIME.test(line)) continue;
      // Un número solo es el índice del bloque cuando la línea siguiente es una marca de tiempo.
      if (BARE_NUMBER.test(line) && CUE_TIME.test(lines[i + 1] ?? "")) continue;
    }
    kept.push(isSubtitleFile ? line.replace(/<[^>]+>/g, "") : line);
  }
  return kept
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type TranscriptCheck = { ok: true; text: string } | { ok: false; error: string };

export function checkTranscriptText(raw: string): TranscriptCheck {
  const text = cleanTranscriptText(raw);
  if (text.length < TRANSCRIPT_MIN_CHARS) return { ok: false, error: "El texto es muy corto para ser una transcripción." };
  if (text.length > TRANSCRIPT_MAX_CHARS) {
    return { ok: false, error: `La transcripción pasa el máximo de ${TRANSCRIPT_MAX_CHARS.toLocaleString("es")} caracteres (tiene ${text.length.toLocaleString("es")}).` };
  }
  return { ok: true, text };
}

/** Une los textos pegados (etiquetas) con lo escrito a mano, en el orden en que se pegaron. */
export function joinPasted(chips: string[], typed: string): string {
  return [...chips, typed].map((t) => t.trim()).filter(Boolean).join("\n\n");
}
