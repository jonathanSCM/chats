import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";

/**
 * Recibe la transcripción de subtítulos que manda la extensión de Chrome
 * (content script corriendo en el navegador de quien esté en la reunión de
 * Meet — no un bot separado, ver dashboard/organization). Auth por Bearer
 * token de portador contra Organization.meetExtensionToken, mismo patrón que
 * api/webhooks/meeting-bot con MEETING_BOT_WEBHOOK_SECRET, pero acá el
 * secreto es por organización (no uno solo global) porque cada instalación
 * de la extensión es de un equipo distinto.
 */
const bodySchema = z.object({
  meetingUrl: z.string().min(1).max(500),
  transcript: z.string().min(1).max(500_000),
  // `sendBeacon` (red de seguridad si se cierra la pestaña sin detectar el
  // fin de la reunión) no permite mandar headers custom -- para ese caso el
  // token viaja acá en vez de en Authorization.
  token: z.string().optional(),
});

// El content script de la extensión corre pegado al origen de la propia
// página de Meet (no al del chrome-extension://), así que el fetch() sale
// como si lo hiciera "https://meet.google.com" -- sujeto a CORS normal,
// aunque el manifest declare host_permissions (eso solo habilita leer la
// respuesta cross-origin, no exime del preflight). Sin estos headers, el
// navegador bloqueaba el POST antes de que llegara acá: confirmado en la
// consola real de un vendedor ("blocked by CORS policy... No
// 'Access-Control-Allow-Origin' header"). sendBeacon (la red de seguridad
// de cierre de pestaña) no lo necesita porque nunca lee la respuesta.
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

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return withCors(new NextResponse("Datos inválidos", { status: 400 }));
  }
  const { meetingUrl, transcript } = parsed.data;

  const token =
    req.headers.get("authorization")?.replace("Bearer ", "").trim() || parsed.data.token;
  if (!token) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const org = await prisma.organization.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true },
  });
  if (!org) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  // Si la reunión ya estaba agendada en el sistema (con ese mismo link), se
  // suma la transcripción ahí -- la más reciente agendada con esa URL, por
  // si el link de una sala se reutiliza en reuniones distintas con el
  // tiempo. Si no hay ninguna, es una llamada que nunca se agendó acá
  // (alguien la abrió directo desde Meet) y se crea una nueva, igual que
  // hace "Unir el bot ya mismo" con reuniones en vivo sin agendar.
  const existing = await prisma.meeting.findFirst({
    where: { organizationId: org.id, meetingUrl, status: { not: "CANCELED" } },
    orderBy: { scheduledAt: "desc" },
  });

  const meeting = existing
    ? await prisma.meeting.update({
        where: { id: existing.id },
        data: {
          // No se pisa una transcripción que ya tenga contenido (por ej. si
          // el bot grabador también corrió en esta misma reunión) -- se
          // concatena en vez de perder una de las dos fuentes.
          transcript: existing.transcript ? `${existing.transcript}\n\n${transcript}` : transcript,
        },
        select: { id: true },
      })
    : await prisma.meeting.create({
        data: {
          organizationId: org.id,
          opportunityId: null,
          title: "Reunión (extensión de subtítulos)",
          scheduledAt: new Date(),
          durationMinutes: 30,
          meetingUrl,
          status: "DONE",
          botEnabled: false,
          transcript,
        },
        select: { id: true },
      });

  // Mismo patrón que el webhook del bot grabador: además de guardar el texto
  // en la fila, queda como adjunto .txt descargable.
  const txtUrl = await saveMediaFile(Buffer.from(transcript, "utf-8"), "text/plain");
  await prisma.meetingAttachment.create({
    data: {
      meetingId: meeting.id,
      url: txtUrl,
      fileName: "transcripcion-subtitulos.txt",
      mimeType: "text/plain",
      fileSize: Buffer.byteLength(transcript, "utf-8"),
    },
  });

  return withCors(NextResponse.json({ ok: true, meetingId: meeting.id }));
}
