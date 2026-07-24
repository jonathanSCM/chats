"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotOwnerAccess } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import { verifyPhoneNumber } from "@/server/services/whatsapp";
import type { ActionState } from "./bots";

const connectSchema = z.object({
  phoneNumberId: z.string().min(1, "Requerido"),
  wabaId: z.string().optional(),
  accessToken: z.string().min(20, "El token no parece válido"),
});

export async function connectWhatsAppAction(
  botId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  const parsed = connectSchema.safeParse({
    phoneNumberId: formData.get("phoneNumberId"),
    wabaId: formData.get("wabaId") || undefined,
    accessToken: formData.get("accessToken"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { phoneNumberId, wabaId, accessToken } = parsed.data;

  let displayNumber: string;
  try {
    const verified = await verifyPhoneNumber({ phoneNumberId, accessToken });
    displayNumber = verified.displayNumber;
  } catch {
    return {
      error: "No se pudo verificar el número con Meta. Revisa el phone_number_id y el token.",
    };
  }

  await prisma.whatsAppConnection.upsert({
    where: { botId: bot.id },
    create: {
      botId: bot.id,
      phoneNumberId,
      wabaId,
      displayNumber,
      accessToken: encrypt(accessToken),
      verified: true,
    },
    update: {
      phoneNumberId,
      wabaId,
      displayNumber,
      accessToken: encrypt(accessToken),
      verified: true,
    },
  });

  revalidatePath(`/dashboard/bots/${bot.id}`);
  return { error: null };
}
