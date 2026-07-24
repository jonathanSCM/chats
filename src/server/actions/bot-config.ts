"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess } from "@/server/auth/guards";
import type { ActionState } from "./bots";

const configSchema = z.object({
  companyName: z.string().min(1, "Requerido").max(120),
  personality: z.string().max(2000).optional(),
  instructions: z.string().max(4000).optional(),
  welcomeMessage: z.string().max(1000).optional(),
});

export async function updateBotConfigAction(
  botId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { bot } = await requireBotAccess(botId);

  const parsed = configSchema.safeParse({
    companyName: formData.get("companyName"),
    personality: formData.get("personality") || undefined,
    instructions: formData.get("instructions") || undefined,
    welcomeMessage: formData.get("welcomeMessage") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.botConfig.upsert({
    where: { botId: bot.id },
    create: { botId: bot.id, ...parsed.data },
    update: parsed.data,
  });

  revalidatePath(`/dashboard/bots/${bot.id}`);
  return { error: null };
}
