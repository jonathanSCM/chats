import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { saveMediaFile } from "@/lib/media-storage";
import { extractMeetCode } from "@/lib/meet-code";
import { classifyShotPage, shotFileName, SHOT_REASONS } from "@/lib/bot-shot";
import { stopMeetingBot } from "@/server/services/meeting-bot";

/**
 * Captura de pantalla del asistente mientras entra a Meet (la manda vexa-patches/apply-shots.js desde el bot).
 * Se guarda como adjunto de la reunión, que la limpieza diaria borra a los 7 días. Auth: el mismo token personal
 * de la extensión que ya usa el parche de subtítulos. Ese token es de una cuenta interna de la plataforma (el asistente
 * es uno solo para todas las organizaciones), así que con ella la reunión se busca en TODAS las organizaciones; un
 * token de una persona común solo ve las de su propia organización.
 *
 * Si la captura muestra que Meet mandó al asistente a otra página (la de inicio de Google, o un pedido de iniciar
 * sesión), no tiene sentido seguir esperando 15 minutos: se anota el motivo y se saca al asistente.
 */
const MAX_IMAGE_BYTES = 1_500_000;
const LIVE_STATUSES = ["PENDING", "JOINING", "WAITING_ADMISSION"] as const;
const PLATFORM_BOT_EMAIL_SUFFIX = "@internal.proshop.lat";

const bodySchema = z.object({
  sessionId: z.number().int().positive().nullable().optional(),
  nativeMeetingId: z.string().max(80).nullable().optional(),
  label: z.string().min(1).max(80),
  pageUrl: z.string().max(500).default(""),
  pageTitle: z.string().max(300).default(""),
  image: z.string().min(1).max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8),
});

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { meetExtensionToken: token }, select: { organizationId: true, email: true } });
  if (!user?.organizationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // La cuenta interna del asistente sirve a todas las organizaciones; cualquier otra, solo a la suya.
  const orgScope = user.email.endsWith(PLATFORM_BOT_EMAIL_SUFFIX) ? {} : { organizationId: user.organizationId };

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  const { sessionId, nativeMeetingId, label, pageUrl, image } = parsed.data;

  const buffer = Buffer.from(image, "base64");
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
  if (!isJpeg || buffer.length > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Imagen inválida" }, { status: 400 });

  // La sesión de Vexa; o, si el CRM todavía no la guardó (la captura llega a los pocos segundos de pedir el
  // asistente), la reunión de esta organización que está entrando a esa sala.
  const select = { id: true, botStatus: true } as const;
  let meeting = sessionId ? await prisma.meeting.findFirst({ where: { ...orgScope, vexaSessionId: sessionId }, select }) : null;
  if (!meeting && nativeMeetingId) {
    const code = extractMeetCode(nativeMeetingId) ?? nativeMeetingId;
    meeting = await prisma.meeting.findFirst({
      where: { ...orgScope, meetingUrl: { contains: code, mode: "insensitive" }, botStatus: { in: [...LIVE_STATUSES] } },
      orderBy: { createdAt: "desc" },
      select,
    });
  }
  if (!meeting) return NextResponse.json({ ok: true, ignored: true }, { status: 202 });

  const url = await saveMediaFile(buffer, "image/jpeg");
  await prisma.meetingAttachment.create({
    data: { meetingId: meeting.id, url, fileName: shotFileName(label, pageUrl), mimeType: "image/jpeg", fileSize: buffer.length },
  });

  const kind = classifyShotPage(pageUrl);
  if ((kind === "inactive" || kind === "sign-in") && meeting.botStatus && (LIVE_STATUSES as readonly string[]).includes(meeting.botStatus)) {
    await prisma.meeting.update({ where: { id: meeting.id }, data: { botFailureReason: SHOT_REASONS[kind] } });
    const stopped = await stopMeetingBot(meeting.id);
    if (!stopped.ok) console.warn(`[meeting-bot-shot] No se pudo sacar al asistente de ${meeting.id}: ${stopped.error}`);
  }

  return NextResponse.json({ ok: true });
}
