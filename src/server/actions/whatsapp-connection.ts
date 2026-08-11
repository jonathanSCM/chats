"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotOwnerAccess, requireSession, HttpError } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import { verifyPhoneNumber } from "@/server/services/whatsapp";
import type { ActionState } from "./types";

async function requireOrgOwner() {
  const session = await requireSession();
  const isOwner = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  if (!isOwner || !session.user.organizationId) {
    throw new HttpError(403, "Solo el dueño de la organización puede hacer esto");
  }
  return session;
}

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
  revalidatePath("/dashboard/whatsapp");
  return { error: null };
}

const nameSchema = z.object({ name: z.string().min(2, "Ponle un nombre").max(60) });

/** Agrega una cuenta de WhatsApp nueva (vacía, sin conectar todavía) a la organización. */
export async function createBotAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireOrgOwner();

  const parsed = nameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.bot.create({
    data: {
      organizationId: session.user.organizationId!,
      name: parsed.data.name,
      status: "ACTIVE",
    },
  });

  revalidatePath("/dashboard/whatsapp");
  return { error: null, message: "Cuenta agregada." };
}

export async function renameBotAction(botId: string, name: string): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  const parsed = nameSchema.safeParse({ name });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.bot.update({ where: { id: bot.id }, data: { name: parsed.data.name } });

  revalidatePath("/dashboard/whatsapp");
  return { error: null };
}

/**
 * Borra solo la conexión de WhatsApp de esta cuenta (token, phone_number_id,
 * waba_id) para poder reconectarla desde cero — no borra el bot ni sus
 * conversaciones. Versión para el propio dueño de la organización, aparte
 * de la que ya existe en el panel de superadmin.
 */
export async function disconnectBotWhatsAppAction(botId: string): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  await prisma.whatsAppConnection.deleteMany({ where: { botId: bot.id } });

  revalidatePath("/dashboard/whatsapp");
  return { error: null, message: "Cuenta desconectada." };
}

/**
 * Da o quita a un vendedor (MEMBER) el acceso a una cuenta de WhatsApp
 * específica — la restricción real que separa qué chats ve cada uno.
 */
export async function toggleBotAccessAction(
  botId: string,
  userId: string,
  granted: boolean,
): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.organizationId !== bot.organizationId) {
    return { error: "Usuario no encontrado en esta organización" };
  }

  if (granted) {
    await prisma.botMember.upsert({
      where: { botId_userId: { botId: bot.id, userId } },
      create: { botId: bot.id, userId },
      update: {},
    });
  } else {
    await prisma.botMember.deleteMany({ where: { botId: bot.id, userId } });
  }

  revalidatePath("/dashboard/organization");
  return { error: null };
}
