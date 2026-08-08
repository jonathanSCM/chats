"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import type { ActionState } from "./types";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

export async function toggleOrgSuspensionAction(
  orgId: string,
  suspended: boolean,
): Promise<ActionState> {
  await requireSuperadmin();

  await prisma.organization.update({ where: { id: orgId }, data: { suspended } });

  revalidatePath(`/admin/organizations/${orgId}`);
  revalidatePath("/admin");
  return { error: null };
}

/**
 * Borra solo la conexión de WhatsApp de un bot (token, phone_number_id,
 * waba_id) para poder volver a intentar Embedded Signup desde cero. No
 * toca la organización, el bot, sus conversaciones ni ningún otro dato.
 */
export async function disconnectWhatsAppAction(botId: string): Promise<ActionState> {
  await requireSuperadmin();

  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { organizationId: true } });
  if (!bot) return { error: "Bot no encontrado" };

  await prisma.whatsAppConnection.deleteMany({ where: { botId } });

  revalidatePath(`/admin/organizations/${bot.organizationId}`);
  return { error: null, message: "Conexión de WhatsApp eliminada." };
}
