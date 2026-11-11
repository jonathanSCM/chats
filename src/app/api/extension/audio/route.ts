import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { resolveExtensionMeeting, resolveExtensionOrg } from "@/server/services/extension-meeting";
import { transcribeAudio } from "@/server/services/audio-transcription";

/**
 * Recibe el audio real que graba la extensión (tabCapture) o el userscript (getDisplayMedia) de Meet en el navegador:
 * las voces de la reunión + el micrófono propio (solo mientras no está silenciado), mezclados, y lo transcribe con el
 * Whisper de OpenAI (services/audio-transcription.ts). Es best-effort: si la transcripción falla, el audio ya quedó
 * guardado como adjunto igual, solo no hay `audioTranscript`.
 *
 * El userscript manda el audio en partes de ~10 minutos (encabezado X-Audio-Part = 1, 2, 3…): cada parte queda como su
 * propio adjunto y su texto se suma al de la reunión. Sin ese encabezado (extensión de Chrome) es una sola grabación.
 *
 * A diferencia de api/extension/transcript, esto lo llama una página de la extensión (o GM_xmlhttpRequest del
 * userscript), no un content script pegado al origen de meet.google.com, así que no pasa por CORS.
 *
 * Auth por Bearer token contra User.meetExtensionToken (token personal, ver dashboard/extension-authorize).
 */
function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  const meetingUrl = req.headers.get("x-meeting-url");
  const mimeType = req.headers.get("content-type") || "audio/webm";

  if (!token || !meetingUrl) {
    return NextResponse.json({ error: "Falta el token o la URL de la reunión" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true, organizationId: true, email: true },
  });
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Audio vacío" }, { status: 400 });
  }

  const org = await resolveExtensionOrg({
    user: { id: user.id, organizationId: user.organizationId, email: user.email },
    meetingUrl,
    requestedOrganizationId: req.headers.get("x-organization-id"),
  });
  if (!org.ok) return NextResponse.json({ error: org.error }, { status: 403 });

  const resolved = await resolveExtensionMeeting({
    organizationId: org.organizationId,
    meetingUrl,
    recordedById: user.id,
    // El nombre viaja codificado (encabezado HTTP): encodeURIComponent en la extensión.
    title: safeDecode(req.headers.get("x-meeting-title")),
  });

  const part = Number(req.headers.get("x-audio-part"));
  const suffix = Number.isInteger(part) && part > 0 ? `-parte-${part}` : "";

  const audioUrl = await saveMediaFile(buffer, mimeType);
  await prisma.meetingAttachment.create({
    data: {
      meetingId: resolved.id,
      url: audioUrl,
      fileName: `grabacion-extension${suffix}.webm`,
      mimeType,
      fileSize: buffer.length,
    },
  });

  const result = await transcribeAudio(org.organizationId, buffer, mimeType);
  if (!result.ok) {
    console.error("[extension/audio] No se pudo transcribir el audio:", result.error);
    return NextResponse.json({ ok: true, meetingId: resolved.id, transcribed: false });
  }
  // Tramo sin nadie hablando (micrófono apagado y reunión en silencio): el audio queda guardado, no hay texto que sumar.
  if (!result.transcript) return NextResponse.json({ ok: true, meetingId: resolved.id, transcribed: true, empty: true });

  // Se relee el texto actual: las partes llegan una tras otra y cada una se suma a lo que ya hay.
  const current = await prisma.meeting.findUnique({ where: { id: resolved.id }, select: { audioTranscript: true } });
  await prisma.meeting.update({
    where: { id: resolved.id },
    data: {
      audioTranscript: current?.audioTranscript ? `${current.audioTranscript}\n\n${result.transcript}` : result.transcript,
    },
  });

  const txtUrl = await saveMediaFile(Buffer.from(result.transcript, "utf-8"), "text/plain");
  await prisma.meetingAttachment.create({
    data: {
      meetingId: resolved.id,
      url: txtUrl,
      fileName: `transcripcion-audio-extension${suffix}.txt`,
      mimeType: "text/plain",
      fileSize: Buffer.byteLength(result.transcript, "utf-8"),
    },
  });

  return NextResponse.json({ ok: true, meetingId: resolved.id, transcribed: true });
}
