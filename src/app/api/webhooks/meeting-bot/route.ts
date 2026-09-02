import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { enqueueOrReschedule, runJobsSoon } from "@/server/jobs";

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

  if (typeof meetingId !== "string" || !(audio instanceof File)) {
    return new NextResponse("Faltan meetingId/audio", { status: 400 });
  }

  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { id: true } });
  if (!meeting) {
    return new NextResponse("Reunión no encontrada", { status: 404 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimeType = audio.type || "audio/mpeg";
  const url = await saveMediaFile(buffer, mimeType);

  const attachment = await prisma.meetingAttachment.create({
    data: {
      meetingId,
      url,
      fileName: audio.name || "grabacion.mp3",
      mimeType,
      fileSize: audio.size,
    },
  });

  await prisma.meeting.update({ where: { id: meetingId }, data: { botStatus: "TRANSCRIBING" } });

  await enqueueOrReschedule({
    type: "meeting_transcribe",
    uniqueKey: `meeting-transcribe-${attachment.id}`,
    payload: { meetingId, attachmentId: attachment.id },
  });
  runJobsSoon();

  return NextResponse.json({ ok: true });
}
