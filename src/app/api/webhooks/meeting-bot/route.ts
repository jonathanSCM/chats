import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";

/**
 * Recibe la grabación que sube el servicio del bot al terminar una reunión
 * (`meeting-bot/`, servicio aparte en Coolify). Mismo patrón de auth que
 * `api/cron/tick`: Bearer constante-time contra un secreto compartido, no la
 * firma HMAC de Meta (acá no hay nada del otro lado que la genere).
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.MEETING_BOT_WEBHOOK_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization")?.replace("Bearer ", "") ?? "";
  const expectedBuf = Buffer.from(secret);
  const providedBuf = Buffer.from(provided);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const form = await req.formData();
  const meetingId = form.get("meetingId");
  const audio = form.get("audio");
  const status = form.get("status");

  if (typeof meetingId !== "string") {
    return new NextResponse("Falta meetingId", { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true } });
  if (!meeting) {
    return new NextResponse("Reunión no encontrada", { status: 404 });
  }

  // El bot avisa así cuando no pudo entrar/grabar/subir — sin esto, la
  // reunión quedaría colgada en "JOINING" para siempre en vez de mostrar el
  // fallo.
  if (status === "failed") {
    await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "FAILED" } });
    return NextResponse.json({ ok: true });
  }

  // Avisa que ya entró y arrancó a grabar de verdad — sin esto, el estado se
  // quedaba pegado en "entrando" (JOINING) durante toda la reunión.
  if (status === "recording") {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { botStatus: "RECORDING", botJoinedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  if (!(audio instanceof File)) {
    return new NextResponse("Falta audio", { status: 400 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimeType = audio.type || "audio/mpeg";
  const url = await saveMediaFile(buffer, mimeType);

  await prisma.meetingAttachment.create({
    data: {
      meetingId,
      url,
      fileName: audio.name || "grabacion.mp3",
      mimeType,
      fileSize: audio.size,
    },
  });

  // La transcripción ya NO se dispara sola acá — si el bot mandó los
  // subtítulos que leyó en vivo (con nombre de quién habló), esa ya es la
  // transcripción definitiva, sin necesidad de Whisper. Si no vinieron
  // (falló la lectura de subtítulos, o Meet no los mostró), queda en
  // "RECORDED" — el audio está listo para bajar, y alguien tiene que pedir
  // la transcripción a mano (botón "Transcribir" en la UI) si la quiere.
  const captionsTranscriptRaw = form.get("captionsTranscript");
  const captionsTranscriptTrimmed = typeof captionsTranscriptRaw === "string" ? captionsTranscriptRaw.trim() : "";
  // Filtro de sanidad extra (además del que ya hace el bot antes de mandarlo):
  // un match de subtítulos real trae varias líneas de diálogo — un texto
  // corto casi seguro viene de un elemento de la interfaz equivocado, no de
  // subtítulos de verdad. Mejor caer al fallback de Whisper que mostrar algo
  // que no es la transcripción real.
  const captionsTranscript = captionsTranscriptTrimmed.length >= 40 ? captionsTranscriptTrimmed : "";

  await prisma.meeting.update({
    where: { id: meetingId },
    data: captionsTranscript
      ? { botStatus: "DONE", botLeftAt: new Date(), transcript: captionsTranscript }
      : { botStatus: "RECORDED", botLeftAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
