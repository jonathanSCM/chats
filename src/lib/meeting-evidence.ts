import { combineTranscripts } from "./meeting-summary";

/**
 * Lo que el calificador de Seguimiento lee de las reuniones de un cliente. Antes solo leía las notas escritas a mano:
 * ahora también la transcripción (subtítulos con nombres y audio transcrito, las dos fuentes juntas para que la IA las
 * concilie, o la subida de una reunión externa) y el resumen automático. Cada reunión se acota para que unas pocas
 * reuniones largas no disparen el costo del análisis.
 */
export const MAX_MEETINGS_FOR_ANALYSIS = 5;
export const MAX_TRANSCRIPT_CHARS_PER_MEETING = 12_000;

export interface MeetingForAnalysis {
  scheduledAt: Date;
  status: string;
  notes: string | null;
  transcript: string | null;
  audioTranscript: string | null;
  aiSummary: string | null;
}

export function hasMeetingEvidence(m: Pick<MeetingForAnalysis, "notes" | "transcript" | "audioTranscript" | "aiSummary">): boolean {
  return Boolean(m.notes?.trim() || m.transcript?.trim() || m.audioTranscript?.trim() || m.aiSummary?.trim());
}

/** Inicio y final de un texto largo, para no mandar la reunión entera. */
function excerpt(text: string, limit = MAX_TRANSCRIPT_CHARS_PER_MEETING): string {
  if (text.length <= limit) return text;
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n[... parte intermedia omitida ...]\n${text.slice(-half)}`;
}

/** El bloque de texto de las reuniones para el prompt; null si ninguna aporta algo. */
export function renderMeetingEvidence(meetings: MeetingForAnalysis[]): string | null {
  const blocks = meetings
    .filter(hasMeetingEvidence)
    .slice(0, MAX_MEETINGS_FOR_ANALYSIS)
    .map((m) => {
      const parts: string[] = [`--- Reunión del ${m.scheduledAt.toISOString().slice(0, 10)} (${m.status}) ---`];
      if (m.notes?.trim()) parts.push(`Notas cargadas por el vendedor:\n${excerpt(m.notes.trim())}`);
      if (m.aiSummary?.trim()) parts.push(`Resumen automático de la reunión:\n${m.aiSummary.trim()}`);
      // Cada fuente se acota por separado (a la mitad del tope) para que una larga no se coma a la otra.
      const side = Math.floor(MAX_TRANSCRIPT_CHARS_PER_MEETING / 2);
      const live = (m.transcript ?? "").trim();
      const audio = (m.audioTranscript ?? "").trim();
      const transcript = combineTranscripts(live ? excerpt(live, side) : null, audio ? excerpt(audio, side) : null);
      if (transcript) parts.push(`Transcripción:\n${transcript}`);
      return parts.join("\n\n");
    });
  return blocks.length ? blocks.join("\n\n") : null;
}
