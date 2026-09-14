import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { resolveExtensionMeeting } from "@/server/services/extension-meeting";
import { isMeetingBotEnabled, scheduleMeetingBotJoinNow } from "@/server/services/meeting-bot";

/**
 * "Unir el asistente" desde la extensión, sin ir a la web -- mismo efecto
 * que "Unir el bot ya mismo" en /dashboard/reuniones (adhoc-meetings.ts,
 * joinMeetingNowAction), pero autenticado con el token personal de la
 * extensión en vez de una sesión de navegador. Reusa resolveExtensionMeeting
 * (mismo helper que transcript/audio) para que, si en esta misma reunión
 * también se usan los subtítulos de la extensión, todo quede en la MISMA
 * fila de Meeting en vez de crear una duplicada.
 */
const bodySchema = z.object({
  meetingUrl: z.string().min(1).max(500),
});

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { meetExtensionToken: token },
    select: { id: true, organizationId: true },
  });
  if (!user?.organizationId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isMeetingBotEnabled()) {
    return NextResponse.json(
      { error: "El asistente no está configurado en el servidor." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const resolved = await resolveExtensionMeeting({
    organizationId: user.organizationId,
    meetingUrl: parsed.data.meetingUrl,
    recordedById: user.id,
  });

  await scheduleMeetingBotJoinNow(resolved.id);

  return NextResponse.json({ ok: true, meetingId: resolved.id });
}
