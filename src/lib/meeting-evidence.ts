import { clampTranscript, pickTranscript } from "./meeting-summary";

/**
 * Lo que el calificador de Seguimiento lee de las reuniones de un cliente. Antes solo leía las notas escritas a mano:
 * ahora también la transcripción (subtítulos, audio o la subida de una reunión externa) y el resumen automático.
 * Cada reunión se acota para que unas pocas reuniones largas no disparen el costo del análisis.
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

function excerpt(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS_PER_MEETING) return text;
  const half = Math.floor(MAX_TRANSCRIPT_CHARS_PER_MEETING / 2);
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
      const transcript = pickTranscript(m.transcript, m.audioTranscript);
      if (transcript) parts.push(`Transcripción:\n${excerpt(clampTranscript(transcript))}`);
      return parts.join("\n\n");
    });
  return blocks.length ? blocks.join("\n\n") : null;
}
