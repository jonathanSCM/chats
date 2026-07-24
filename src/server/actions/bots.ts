"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, requireBotAccess } from "@/server/auth/guards";

export interface ActionState {
  error: string | null;
  message?: string;
}

const createBotSchema = z.object({
  name: z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(80),
});

export async function createBotAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();
  if (!session.user.organizationId) {
    return { error: "Tu usuario no pertenece a ninguna organización" };
  }

  const parsed = createBotSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const bot = await prisma.bot.create({
    data: { organizationId: session.user.organizationId, name: parsed.data.name },
  });

  revalidatePath("/dashboard");
  redirect(`/dashboard/bots/${bot.id}`);
}

export async function setBotStatusAction(
  botId: string,
  status: "ACTIVE" | "PAUSED" | "DRAFT",
): Promise<ActionState> {
  const { bot } = await requireBotAccess(botId);

  if (status === "ACTIVE") {
    const config = await prisma.botConfig.findUnique({ where: { botId: bot.id } });
    const connection = await prisma.whatsAppConnection.findUnique({ where: { botId: bot.id } });
    if (!config?.instructions || !connection?.verified) {
      return {
        error:
          "Completa las instrucciones del bot y verifica la conexión de WhatsApp antes de activarlo",
      };
    }
  }

  await prisma.bot.update({ where: { id: bot.id }, data: { status } });
  revalidatePath(`/dashboard/bots/${bot.id}`);
  revalidatePath("/dashboard");
  return { error: null };
}
