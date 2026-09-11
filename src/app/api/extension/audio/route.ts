import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { resolveExtensionMeeting } from "@/server/services/extension-meeting";
import { transcribeAudioViaBotService } from "@/server/services/meeting-bot";

/**
 * Recibe el audio real que graba la extensión de subtítulos de Meet en el
 * navegador (tabCapture del resto de los participantes + micrófono propio,
 * mezclados -- ver offscreen.js) y lo pasa por whisper.cpp reutilizando el
 * servicio del bot grabador (services/meeting-bot.ts), sin duplicar el
 * binario/modelo acá. Es best-effort: si whisper.cpp falla, el audio ya
 * quedó guardado como adjunto igual, solo no hay `audioTranscript`.
 *
 * A diferencia de api/extension/transcript, esto lo llama el "offscreen
 * document" de la extensión (una página de la extensión, no un content
 * script pegado al origen de meet.google.com), así que no pasa por CORS --
 * host_permissions alcanza, no hace falta manejar OPTIONS acá.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  const meetingUrl = req.headers.get("x-meeting-url");
  const mimeType = req.headers.get("content-type") || "audio/webm";

  if (!token || !meetingUrl) {
    return NextResponse.json({ error: "Falta el token o la URL de la reunión" }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true },
  });
  if (!org) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Audio vacío" }, { status: 400 });
  }

  const resolved = await resolveExtensionMeeting({ organizationId: org.id, meetingUrl });

  const audioUrl = await saveMediaFile(buffer, mimeType);
  await prisma.meetingAttachment.create({
    data: {
      meetingId: resolved.id,
      url: audioUrl,
      fileName: "grabacion-extension.webm",
      mimeType,
      fileSize: buffer.length,
    },
  });

  const result = await transcribeAudioViaBotService(buffer, mimeType);
  if (!result.ok) {
    console.error("[extension/audio] No se pudo transcribir con whisper.cpp:", result.error);
    return NextResponse.json({ ok: true, meetingId: resolved.id, transcribed: false });
  }

  await prisma.meeting.update({
    where: { id: resolved.id },
    data: {
      audioTranscript: resolved.audioTranscript
        ? `${resolved.audioTranscript}\n\n${result.transcript}`
        : result.transcript,
    },
  });

  const txtUrl = await saveMediaFile(Buffer.from(result.transcript, "utf-8"), "text/plain");
  await prisma.meetingAttachment.create({
    data: {
      meetingId: resolved.id,
      url: txtUrl,
      fileName: "transcripcion-audio-extension.txt",
      mimeType: "text/plain",
      fileSize: Buffer.byteLength(result.transcript, "utf-8"),
    },
  });

  return NextResponse.json({ ok: true, meetingId: resolved.id, transcribed: true });
}
