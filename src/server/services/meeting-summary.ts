import { prisma } from "@/server/db/client";
import { runStructured, MODELS, isAiEnabled } from "@/server/services/ai/client";
import {
  MEETING_SUMMARY_VERSION,
  MIN_TRANSCRIPT_CHARS,
  clampTranscript,
  meetingSummarySchema,
  parseMeetingSummary,
  pickTranscript,
  renderSummaryText,
  type MeetingSummaryData,
} from "@/lib/meeting-summary";

const nullableString = { type: ["string", "null"] } as const;
const stringList = { type: "array", items: { type: "string" } } as const;

const SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["resumen", "puntosClave", "decisiones", "proximosPasos", "informacionComercial"],
  properties: {
    resumen: { type: "string", description: "3 a 5 oraciones con lo esencial de la reunión." },
    puntosClave: stringList,
    decisiones: stringList,
    proximosPasos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["accion", "responsable", "fecha", "fechaIso"],
        properties: {
          accion: { type: "string" },
          responsable: { ...nullableString, description: "Quién lo hará, solo si se dijo. Si no, null." },
          fechaIso: {
            ...nullableString,
            description:
              "Esa misma fecha como yyyy-mm-dd, calculada a partir de la fecha de la reunión (ej. 'el viernes' = el próximo viernes). Si no se puede calcular con certeza, null.",
          },
          fecha: { ...nullableString, description: "Fecha o plazo tal como se dijo (ej. 'el viernes'). Si no se dijo, null." },
        },
      },
    },
    informacionComercial: {
      type: "object",
      additionalProperties: false,
      required: ["necesidad", "dolor", "presupuesto", "decisor", "urgencia", "objeciones", "acuerdos"],
      properties: {
        necesidad: nullableString,
        dolor: nullableString,
        presupuesto: nullableString,
        decisor: nullableString,
        urgencia: nullableString,
        objeciones: stringList,
        acuerdos: stringList,
      },
    },
  },
} as const;

const SUMMARY_SYSTEM = [
  "Analizás la transcripción de una reunión de trabajo o comercial y devolvés un resumen ejecutivo en español.",
  "REGLAS:",
  "- No inventes nada que no esté en el texto. Si un dato no aparece, usá null (o una lista vacía).",
  "- No completes responsable ni fecha por deducción: solo si se dijeron.",
  "- informacionComercial describe al CLIENTE o prospecto: su necesidad, el dolor concreto, el presupuesto mencionado, quién decide, la urgencia, las objeciones y lo acordado.",
  "- Si la reunión es interna y no hay cliente, dejá informacionComercial en null/listas vacías.",
  "- Los subtítulos en vivo pueden tener errores de transcripción: interpretá con cuidado y no cites literal lo dudoso.",
  "- Sé breve y concreto. Cada ítem de una lista es una frase corta.",
].join("\n");

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const line = (label: string, value: string | null | undefined) => (value ? `${label}: ${value}` : null);

/**
 * Resumen "hasta ahora" de una reunión en curso (comando /bot resumen): usa el
 * mismo modelo y esquema pero NO se guarda, porque la reunión no terminó.
 */
export async function summarizeTranscriptNow(options: {
  organizationId: string;
  meetingId: string;
  transcript: string;
}): Promise<MeetingSummaryData> {
  return runStructured<MeetingSummaryData>({
    organizationId: options.organizationId,
    entityType: "Meeting",
    entityId: options.meetingId,
    analysisType: "meeting_summary_live",
    promptVersion: MEETING_SUMMARY_VERSION,
    model: MODELS.fast(),
    system: SUMMARY_SYSTEM,
    input: `TRANSCRIPCIÓN (reunión en curso)
${clampTranscript(options.transcript)}`,
    schemaName: "resumen_reunion",
    schema: SUMMARY_JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: parseMeetingSummary,
  });
}

export type GenerateResult =
  | { status: "generated"; data: MeetingSummaryData }
  | { status: "too_short" }
  | { status: "no_transcript" }
  | { status: "ai_disabled" }
  | { status: "not_found" };

/**
 * Genera y guarda el resumen de una reunión. Lanza si la IA falla o se
 * excede el presupuesto diario (el job de la cola reintenta).
 */
export async function generateMeetingSummary(meetingId: string): Promise<GenerateResult> {
  if (!isAiEnabled()) return { status: "ai_disabled" };

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      organizationId: true,
      title: true,
      scheduledAt: true,
      durationMinutes: true,
      guestEmails: true,
      notes: true,
      transcript: true,
      audioTranscript: true,
      opportunity: { select: { title: true, contact: { select: { fullName: true, phone: true } } } },
    },
  });
  if (!meeting) return { status: "not_found" };

  const raw = pickTranscript(meeting.transcript, meeting.audioTranscript);
  if (!raw) return { status: "no_transcript" };
  if (raw.length < MIN_TRANSCRIPT_CHARS) {
    // Se marca como revisada para que el barrido no la vuelva a tomar hasta que cambie.
    await prisma.meeting.update({ where: { id: meetingId }, data: { aiSummaryAt: new Date() } });
    return { status: "too_short" };
  }

  const clientName = meeting.opportunity?.contact.fullName || meeting.opportunity?.contact.phone || null;
  const header = [
    line("Título", meeting.title),
    `Fecha: ${meeting.scheduledAt.toISOString().slice(0, 10)} (${WEEKDAYS[meeting.scheduledAt.getUTCDay()]})`,
    `Duración prevista: ${meeting.durationMinutes} min`,
    meeting.guestEmails.length ? `Invitados: ${meeting.guestEmails.join(", ")}` : null,
    line("Cliente", clientName),
    line("Oportunidad", meeting.opportunity?.title),
    meeting.notes ? `Notas del vendedor (cargadas a mano):\n${meeting.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const data = await runStructured<MeetingSummaryData>({
    organizationId: meeting.organizationId,
    entityType: "Meeting",
    entityId: meeting.id,
    analysisType: "meeting_summary",
    promptVersion: MEETING_SUMMARY_VERSION,
    model: MODELS.fast(),
    system: SUMMARY_SYSTEM,
    input: `${header}\n\nTRANSCRIPCIÓN\n${clampTranscript(raw)}`,
    schemaName: "resumen_reunion",
    schema: SUMMARY_JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: parseMeetingSummary,
  });

  await prisma.meeting.update({
    where: { id: meetingId },
    data: { aiSummary: renderSummaryText(data), aiSummaryData: data as never, aiSummaryAt: new Date() },
  });

  return { status: "generated", data };
}

/** Datos ya guardados si existen y son válidos; si no, los genera. Lo usa también el PDF. */
export async function ensureMeetingSummaryData(meetingId: string): Promise<MeetingSummaryData | null> {
  const stored = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { aiSummaryData: true } });
  const parsed = meetingSummarySchema.safeParse(stored?.aiSummaryData);
  if (parsed.success) return parsed.data;

  const result = await generateMeetingSummary(meetingId);
  return result.status === "generated" ? result.data : null;
}
