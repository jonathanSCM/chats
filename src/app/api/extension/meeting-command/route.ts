import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { stopMeetingBot } from "@/server/services/meeting-bot";
import { summarizeMeetingTranscript } from "@/server/services/meeting-summary-pdf";

/**
 * Comandos escritos en el chat de la propia reunión de Google Meet (no
 * WhatsApp) -- el parche de subtítulos del bot (ver /opt/vexa-patches en el
 * VPS) lee el panel de chat de Meet, detecta líneas que empiezan con
 * "/bot ", y las manda acá para ejecutarlas. La respuesta que devuelve este
 * endpoint es el texto que el parche escribe de vuelta en el chat de Meet --
 * visible para todos los participantes de la llamada, así que corto y sin
 * datos sensibles.
 */
const bodySchema = z.object({
  meetingUrl: z.string().min(1).max(500),
  command: z.string().min(1).max(200),
});

const ALLOWED_ORIGIN = "https://meet.google.com";

function withCors(res: NextResponse): NextResponse {
  res.headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export function OPTIONS(): NextResponse {
  return withCors(new NextResponse(null, { status: 204 }));
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "todavía no entró",
  JOINING: "entrando ahora",
  RECORDING: "grabando",
  TRANSCRIBING: "salió, transcribiendo el audio",
  DONE: "terminó, transcripción lista",
  FAILED: "falló -- revisar en el CRM",
};

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(new NextResponse("Datos inválidos", { status: 400 }));
  }
  const { meetingUrl, command } = parsed.data;

  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { organizationId: true },
  });
  if (!user?.organizationId) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  // A diferencia de resolveExtensionMeeting (api/extension/transcript), acá
  // NO se crea una reunión si no existe -- un comando sin una reunión de bot
  // real detrás no tiene nada que ejecutar.
  const meeting = await prisma.meeting.findFirst({
    where: { organizationId: user.organizationId, meetingUrl, status: { not: "CANCELED" }, botStatus: { not: null } },
    orderBy: { scheduledAt: "desc" },
    select: { id: true, botStatus: true, transcript: true, audioTranscript: true },
  });
  if (!meeting) {
    return withCors(NextResponse.json({ ok: true, reply: "Asistente: no encuentro una reunión con bot para este link." }));
  }

  const cmd = command.trim().toLowerCase();

  if (cmd === "estado" || cmd === "status") {
    const label = meeting.botStatus ? (STATUS_LABEL[meeting.botStatus] ?? meeting.botStatus) : "sin bot pedido";
    return withCors(NextResponse.json({ ok: true, reply: `Asistente: ${label}.` }));
  }

  if (cmd === "detener" || cmd === "parar" || cmd === "stop") {
    const result = await stopMeetingBot(meeting.id);
    const reply = result.ok
      ? "Asistente: listo, salgo de la reunión."
      : `Asistente: no pude salir (${result.error ?? "error desconocido"}).`;
    return withCors(NextResponse.json({ ok: true, reply }));
  }

  if (cmd === "resumen" || cmd === "resumir") {
    const transcriptText = meeting.transcript || meeting.audioTranscript;
    if (!transcriptText) {
      return withCors(NextResponse.json({ ok: true, reply: "Asistente: todavía no hay suficiente transcripción para resumir." }));
    }
    try {
      const summary = await summarizeMeetingTranscript({
        organizationId: user.organizationId,
        meetingId: meeting.id,
        transcript: transcriptText,
      });
      return withCors(NextResponse.json({ ok: true, reply: `Asistente (resumen hasta ahora): ${summary.resumen}` }));
    } catch {
      return withCors(NextResponse.json({ ok: true, reply: "Asistente: no pude generar el resumen ahora, probá de nuevo en un rato." }));
    }
  }

  return withCors(
    NextResponse.json({ ok: true, reply: "Asistente: comandos -- /bot estado, /bot resumen, /bot detener." }),
  );
}
