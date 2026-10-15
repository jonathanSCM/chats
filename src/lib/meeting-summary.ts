import { z } from "zod";

// Parte pura del resumen de reuniones (sin base de datos): la usan el servidor
// (services/meeting-summary.ts) y la interfaz (components/meeting-ai-summary.tsx).

export const MEETING_SUMMARY_VERSION = "v2";

/** Menos que esto no hay nada que resumir (un par de frases sueltas de subtítulos). */
export const MIN_TRANSCRIPT_CHARS = 400;
/** Tope de texto enviado al modelo; las reuniones muy largas se resumen con inicio y final. */
export const MAX_TRANSCRIPT_CHARS = 120_000;

const textList = z.array(z.string());

export const meetingSummarySchema = z.object({
  resumen: z.string(),
  puntosClave: textList,
  decisiones: textList,
  proximosPasos: z.array(
    z.object({
      accion: z.string(),
      responsable: z.string().nullable(),
      fecha: z.string().nullable(),
    }),
  ),
  informacionComercial: z.object({
    necesidad: z.string().nullable(),
    dolor: z.string().nullable(),
    presupuesto: z.string().nullable(),
    decisor: z.string().nullable(),
    urgencia: z.string().nullable(),
    objeciones: textList,
    acuerdos: textList,
  }),
});

export type MeetingSummaryData = z.infer<typeof meetingSummarySchema>;

export function parseMeetingSummary(raw: unknown): MeetingSummaryData {
  return meetingSummarySchema.parse(raw);
}

/**
 * Elige el texto a resumir: la transcripción en vivo trae quién habló, el
 * audio transcrito es más completo. Se usa el audio solo si los subtítulos
 * quedaron muy incompletos.
 */
export function pickTranscript(transcript: string | null, audioTranscript: string | null): string {
  const live = (transcript ?? "").trim();
  const audio = (audioTranscript ?? "").trim();
  if (!live) return audio;
  if (!audio) return live;
  return live.length >= audio.length * 0.6 ? live : audio;
}

export function clampTranscript(text: string): string {
  if (text.length <= MAX_TRANSCRIPT_CHARS) return text;
  const half = Math.floor(MAX_TRANSCRIPT_CHARS / 2);
  return `${text.slice(0, half)}\n\n[... se omitió una parte intermedia de la reunión por su extensión ...]\n\n${text.slice(-half)}`;
}

const stripDot = (text: string) => text.trim().replace(/\.$/, "");
const line = (label: string, value: string | null | undefined) => (value ? `${label}: ${value}` : null);

/** Texto legible para guardar en `Meeting.aiSummary` y mostrar sin parsear JSON. */
export function renderSummaryText(data: MeetingSummaryData): string {
  const c = data.informacionComercial;
  const parts: string[] = [`RESUMEN\n${data.resumen}`];

  if (data.puntosClave.length) parts.push(`PUNTOS CLAVE\n${data.puntosClave.map((p) => `- ${p}`).join("\n")}`);
  if (data.decisiones.length) parts.push(`DECISIONES\n${data.decisiones.map((d) => `- ${d}`).join("\n")}`);
  if (data.proximosPasos.length) {
    parts.push(
      `PRÓXIMOS PASOS\n${data.proximosPasos
        .map((p) => `- ${[p.accion, p.responsable && `responsable: ${p.responsable}`, p.fecha && `fecha: ${p.fecha}`].filter(Boolean).join(" — ")}`)
        .join("\n")}`,
    );
  }

  const commercial = [
    line("Necesidad", c.necesidad),
    line("Dolor", c.dolor),
    line("Presupuesto", c.presupuesto),
    line("Decisor", c.decisor),
    line("Urgencia", c.urgencia),
    c.objeciones.length ? `Objeciones: ${c.objeciones.map(stripDot).join("; ")}` : null,
    c.acuerdos.length ? `Acuerdos: ${c.acuerdos.map(stripDot).join("; ")}` : null,
  ].filter(Boolean);
  if (commercial.length) parts.push(`INFORMACIÓN COMERCIAL\n${commercial.join("\n")}`);

  return parts.join("\n\n");
}

