import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { resolveExtensionMeeting } from "@/server/services/extension-meeting";
import { attemptAutoLinkMeeting } from "@/server/services/meeting-link";

/**
 * Recibe la transcripción de subtítulos que manda la extensión de Chrome
 * (content script corriendo en el navegador de quien esté en la reunión de
 * Meet — no un bot separado, ver dashboard/extension-authorize). Auth por
 * Bearer token contra User.meetExtensionToken -- token personal por
 * vendedor (antes era uno solo por organización), así de paso se sabe quién
 * grabó cada reunión.
 */
const bodySchema = z.object({
  meetingUrl: z.string().min(1).max(500),
  transcript: z.string().min(1).max(500_000),
  // `sendBeacon` (red de seguridad si se cierra la pestaña sin detectar el
  // fin de la reunión) no permite mandar headers custom -- para ese caso el
  // token viaja acá en vez de en Authorization.
  token: z.string().optional(),
  // El bot de Vexa (parche de subtítulos de Meet) manda esto cada ~20s
  // durante toda la reunión para tener el texto al día en vivo -- sin
  // `final`, cada una de esas llamadas guardaba un .txt nuevo (uno por
  // reunión larga terminaba con decenas de adjuntos). Ausente/true (el caso
  // de la extensión, que solo llama una vez al final) sigue guardando el
  // adjunto como siempre; `false` solo actualiza el texto en la reunión.
  final: z.boolean().optional(),
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
  const { meetingUrl, transcript, final } = parsed.data;

  const token =
    req.headers.get("authorization")?.replace("Bearer ", "").trim() || parsed.data.token;
  if (!token) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true, organizationId: true },
  });
  if (!user?.organizationId) {
    return withCors(new NextResponse("Unauthorized", { status: 401 }));
  }

  const resolved = await resolveExtensionMeeting({
    organizationId: user.organizationId,
    meetingUrl,
    recordedById: user.id,
  });

  // No se pisa una transcripción que ya tenga contenido (por ej. si el bot
  // grabador también corrió en esta misma reunión) -- se concatena en vez
  // de perder una de las dos fuentes. El llamador (extensión, o el parche de
  // subtítulos del bot de Vexa) manda solo texto NUEVO en cada llamada, no
  // todo lo acumulado de nuevo -- si mandara todo de nuevo cada vez, esto
  // se duplicaría en cascada con cada actualización.
  const newTranscriptValue = resolved.transcript ? `${resolved.transcript}\n\n${transcript}` : transcript;
  const meeting = await prisma.meeting.update({
    where: { id: resolved.id },
    data: { transcript: newTranscriptValue },
    select: { id: true },
  });

  // El parche de subtítulos del bot manda una actualización cada ~20s
  // durante toda la reunión (final=false) para tener el texto al día en
  // vivo -- sin este chequeo, una reunión larga terminaba con un adjunto
  // .txt nuevo por cada actualización. Solo se guarda el adjunto al final
  // (final ausente/true, el caso de siempre de la extensión, o final=true
  // explícito), y con el texto COMPLETO acumulado hasta ese momento, no
  // solo el pedacito nuevo de esta última llamada.
  if (final !== false) {
    const txtUrl = await saveMediaFile(Buffer.from(newTranscriptValue, "utf-8"), "text/plain");
    await prisma.meetingAttachment.create({
      data: {
        meetingId: meeting.id,
        url: txtUrl,
        fileName: "transcripcion-subtitulos.txt",
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(newTranscriptValue, "utf-8"),
      },
    });
    // Recién con el texto completo (no un pedacito a mitad de reunión) tiene
    // sentido intentar reconocer quién habló -- best-effort, no bloquea la
    // respuesta si falla.
    await attemptAutoLinkMeeting(meeting.id).catch((error) => {
      console.error(`[extension/transcript] No se pudo auto-vincular la reunión ${meeting.id}:`, error);
    });
  }

  return withCors(NextResponse.json({ ok: true, meetingId: meeting.id }));
}
