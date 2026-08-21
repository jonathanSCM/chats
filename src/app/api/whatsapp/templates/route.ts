import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { requireBotAccess, HttpError } from "@/server/auth/guards";
import { decrypt } from "@/lib/crypto";
import { listMessageTemplates } from "@/server/services/whatsapp";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const botId = url.searchParams.get("botId");
  const all = url.searchParams.get("all") === "1";
  if (!botId) return NextResponse.json({ error: "Falta botId" }, { status: 400 });

  let bot;
  try {
    ({ bot } = await requireBotAccess(botId));
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const connection = await prisma.whatsAppConnection.findUnique({ where: { botId: bot.id } });
  if (!connection?.verified) {
    return NextResponse.json({ error: "WhatsApp no está conectado" }, { status: 400 });
  }
  if (!connection.wabaId) {
    return NextResponse.json(
      { error: "Esta conexión no tiene un WABA ID guardado — no se pueden leer sus plantillas." },
      { status: 400 },
    );
  }

  try {
    const templates = await listMessageTemplates({
      wabaId: connection.wabaId,
      accessToken: decrypt(connection.accessToken),
    });
    return NextResponse.json({
      templates: all ? templates : templates.filter((t) => t.status === "APPROVED"),
    });
  } catch (error) {
    console.error("[whatsapp] No se pudieron leer las plantillas:", error);
    return NextResponse.json({ error: "No se pudieron leer las plantillas desde Meta." }, { status: 502 });
  }
}
