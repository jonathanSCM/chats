"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotOwnerAccess } from "@/server/auth/guards";
import { decrypt } from "@/lib/crypto";
import { getPlatformSettings } from "@/server/services/platform-settings";
import {
  getBusinessProfile,
  updateBusinessProfile,
  uploadBusinessProfilePhoto,
} from "@/server/services/whatsapp";
import type { ActionState } from "./types";

const PATH = "/dashboard/whatsapp";

async function requireConnection(botId: string) {
  const { bot } = await requireBotOwnerAccess(botId);

  const connection = await prisma.whatsAppConnection.findUnique({ where: { botId: bot.id } });
  if (!connection || !connection.verified) {
    throw new Error("Conecta y verifica el número antes de editar el perfil de negocio.");
  }

  return { phoneNumberId: connection.phoneNumberId, accessToken: decrypt(connection.accessToken) };
}

const websiteSchema = z.string().url("URL inválida").max(256).or(z.literal(""));

const profileSchema = z.object({
  about: z.string().max(139, "Máximo 139 caracteres").optional().default(""),
  description: z.string().max(512, "Máximo 512 caracteres").optional().default(""),
  address: z.string().max(256, "Máximo 256 caracteres").optional().default(""),
  email: z.string().email("Correo inválido").max(128).or(z.literal("")).optional().default(""),
  website1: websiteSchema.optional().default(""),
  website2: websiteSchema.optional().default(""),
  vertical: z.string().optional().default("UNDEFINED"),
});

export async function getBusinessProfileForBot(botId: string) {
  const { phoneNumberId, accessToken } = await requireConnection(botId);
  return getBusinessProfile({ phoneNumberId, accessToken });
}

export async function updateBusinessProfileAction(
  botId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let connection: Awaited<ReturnType<typeof requireConnection>>;
  try {
    connection = await requireConnection(botId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sin acceso" };
  }

  const parsed = profileSchema.safeParse({
    about: formData.get("about") || undefined,
    description: formData.get("description") || undefined,
    address: formData.get("address") || undefined,
    email: formData.get("email") || undefined,
    website1: formData.get("website1") || undefined,
    website2: formData.get("website2") || undefined,
    vertical: formData.get("vertical") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const websites = [parsed.data.website1, parsed.data.website2].filter(Boolean);

  try {
    await updateBusinessProfile({
      phoneNumberId: connection.phoneNumberId,
      accessToken: connection.accessToken,
      data: {
        about: parsed.data.about,
        description: parsed.data.description,
        address: parsed.data.address,
        email: parsed.data.email,
        websites,
        vertical: parsed.data.vertical,
      },
    });
  } catch (error) {
    console.error("[business-profile] No se pudo actualizar:", error);
    return { error: "Meta rechazó el cambio. Revisa los datos e intenta de nuevo." };
  }

  revalidatePath(PATH);
  return { error: null, message: "Perfil actualizado." };
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // límite de Meta para la foto de perfil
const ALLOWED_PHOTO_MIME = ["image/jpeg", "image/png"];

export async function updateBusinessPhotoAction(
  botId: string,
  formData: FormData,
): Promise<ActionState> {
  let connection: Awaited<ReturnType<typeof requireConnection>>;
  try {
    connection = await requireConnection(botId);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sin acceso" };
  }

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecciona una imagen." };
  }
  if (!ALLOWED_PHOTO_MIME.includes(file.type)) {
    return { error: "Solo se aceptan imágenes JPEG o PNG." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { error: "La imagen no puede pesar más de 5 MB." };
  }

  const settings = await getPlatformSettings();
  if (!settings.whatsappAppId) {
    return { error: "Falta WHATSAPP_APP_ID. Configúralo en Configuración (admin)." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const handle = await uploadBusinessProfilePhoto({
      appId: settings.whatsappAppId,
      accessToken: connection.accessToken,
      file: buffer,
      mimeType: file.type,
    });
    await updateBusinessProfile({
      phoneNumberId: connection.phoneNumberId,
      accessToken: connection.accessToken,
      data: { profilePictureHandle: handle },
    });
  } catch (error) {
    console.error("[business-profile] No se pudo subir la foto:", error);
    return { error: "No se pudo subir la foto. Intenta con otra imagen." };
  }

  revalidatePath(PATH);
  return { error: null, message: "Foto actualizada." };
}
