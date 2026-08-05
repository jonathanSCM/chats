"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession, HttpError } from "@/server/auth/guards";
import { encrypt } from "@/lib/crypto";
import { invalidatePlatformSettingsCache } from "@/server/services/platform-settings";
import type { ActionState } from "./types";

async function requireSuperadmin() {
  const session = await requireSession();
  if (session.user.role !== "SUPERADMIN") {
    throw new HttpError(403, "Solo el superadmin puede hacer esto");
  }
  return session;
}

const schema = z.object({
  whatsappAppId: z.string().max(60).optional().default(""),
  whatsappConfigId: z.string().max(60).optional().default(""),
  whatsappVerifyToken: z.string().max(120).optional().default(""),
  // Vacío = no cambiar (no se vuelve a mostrar en claro, igual que el
  // access token de cada conexión de WhatsApp).
  whatsappAppSecret: z.string().max(200).optional().default(""),
});

export async function updatePlatformSettingsAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSuperadmin();

  const parsed = schema.safeParse({
    whatsappAppId: formData.get("whatsappAppId") || undefined,
    whatsappConfigId: formData.get("whatsappConfigId") || undefined,
    whatsappVerifyToken: formData.get("whatsappVerifyToken") || undefined,
    whatsappAppSecret: formData.get("whatsappAppSecret") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const data: {
    whatsappAppId: string | null;
    whatsappConfigId: string | null;
    whatsappVerifyToken: string | null;
    whatsappAppSecret?: string;
  } = {
    whatsappAppId: parsed.data.whatsappAppId || null,
    whatsappConfigId: parsed.data.whatsappConfigId || null,
    whatsappVerifyToken: parsed.data.whatsappVerifyToken || null,
  };
  if (parsed.data.whatsappAppSecret) {
    data.whatsappAppSecret = encrypt(parsed.data.whatsappAppSecret);
  }

  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });

  invalidatePlatformSettingsCache();
  revalidatePath("/admin/settings");
  revalidatePath("/dashboard/whatsapp");
  return { error: null, message: "Configuración guardada." };
}
