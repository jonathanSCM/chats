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

  // Avisa que ya salió de la reunión y arrancó a transcribir el audio con
  // whisper.cpp (puede tardar unos minutos) — sin esto, el estado se quedaba
  // en "Grabando" aunque la reunión ya haya terminado de verdad. Este es el
  // momento real en que el bot dejó la llamada, así que `botLeftAt` se marca
  // acá, no cuando termina de subir (que puede ser varios minutos después).
  if (status === "transcribing") {
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { botStatus: "TRANSCRIBING", botLeftAt: new Date() },
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

  // Dos transcripciones que se complementan, ninguna bloquea a la otra: los
  // subtítulos en vivo de Meet (con nombre de quién habló, pero pueden tener
  // huecos) y whisper.cpp corrido local en el bot sobre el audio completo
  // (sin nombres, pero sin huecos). Ya no hace falta pedir la transcripción
  // a mano — whisper.cpp es gratis, así que el bot ya la manda siempre.
  const captionsTranscriptRaw = form.get("captionsTranscript");
  const captionsTranscriptTrimmed = typeof captionsTranscriptRaw === "string" ? captionsTranscriptRaw.trim() : "";
  // Filtro de sanidad (además del que ya hace el bot antes de mandarlo): un
  // match de subtítulos real trae varias líneas de diálogo — un texto corto
  // casi seguro viene de un elemento de la interfaz equivocado, no de
  // subtítulos de verdad.
  const captionsTranscript = captionsTranscriptTrimmed.length >= 40 ? captionsTranscriptTrimmed : "";

  const audioTranscriptRaw = form.get("audioTranscript");
  const audioTranscript = typeof audioTranscriptRaw === "string" ? audioTranscriptRaw.trim() : "";

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      botStatus: "DONE",
      transcript: captionsTranscript || null,
      audioTranscript: audioTranscript || null,
    },
  });

  // Además de guardarse en la fila (lo que usa "Generar resumen (PDF)"),
  // cada transcripción se guarda como adjunto .txt -- de texto plano, se
  // abre en una pestaña nueva y se lee/scrollea ahí, en vez de tener que
  // mostrar un bloque larguísimo adentro de la propia página.
  if (captionsTranscript) {
    const txtUrl = await saveMediaFile(Buffer.from(captionsTranscript, "utf-8"), "text/plain");
    await prisma.meetingAttachment.create({
      data: {
        meetingId,
        url: txtUrl,
        fileName: "transcripcion-subtitulos.txt",
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(captionsTranscript, "utf-8"),
      },
    });
  }
  if (audioTranscript) {
    const txtUrl = await saveMediaFile(Buffer.from(audioTranscript, "utf-8"), "text/plain");
    await prisma.meetingAttachment.create({
      data: {
        meetingId,
        url: txtUrl,
        fileName: "transcripcion-audio-completo.txt",
        mimeType: "text/plain",
        fileSize: Buffer.byteLength(audioTranscript, "utf-8"),
      },
    });
  }

  return NextResponse.json({ ok: true });
}
