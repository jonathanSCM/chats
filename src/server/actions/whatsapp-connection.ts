"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotOwnerAccess, requireSession, HttpError } from "@/server/auth/guards";
import { encrypt, decrypt } from "@/lib/crypto";
import {
  verifyPhoneNumber,
  createMessageTemplate,
  deleteMessageTemplate,
  type TemplateCategory,
} from "@/server/services/whatsapp";
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
 * Prende o apaga el bot de calificación por IA para esta cuenta. Apagado
 * es el valor por defecto: hay que activarlo a propósito por número.
 */
export async function setAiQualificationEnabledAction(
  botId: string,
  enabled: boolean,
): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  await prisma.bot.update({ where: { id: bot.id }, data: { aiQualificationEnabled: enabled } });

  revalidatePath("/dashboard/whatsapp");
  return {
    error: null,
    message: enabled ? "Bot de calificación activado." : "Bot de calificación desactivado.",
  };
}

const testPhoneSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\d{6,15}$/, "Solo dígitos, sin +, espacios ni guiones (ej. 59178795415)")
    .optional()
    .or(z.literal("")),
});

/**
 * Carga o quita el teléfono de prueba: mientras esté cargado, el bot de
 * calificación solo contesta ese número aunque esté activado para toda la
 * cuenta — para poder probar en producción sin arriesgar leads reales.
 */
export async function setAiTestPhoneAction(botId: string, phone: string): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  const parsed = testPhoneSchema.safeParse({ phone });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Teléfono inválido" };
  }

  await prisma.bot.update({
    where: { id: bot.id },
    data: { aiTestPhone: parsed.data.phone || null },
  });

  revalidatePath("/dashboard/whatsapp");
  return {
    error: null,
    message: parsed.data.phone ? "Modo de prueba activado." : "Modo de prueba desactivado.",
  };
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

const templateNameSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[a-z0-9_]+$/, "Solo minúsculas, números y guion bajo (_), sin espacios");

const createTemplateSchema = z.object({
  name: templateNameSchema,
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  languageCode: z.string().min(2).max(10),
  bodyText: z.string().min(1).max(1024),
  bodyExample: z.string().max(1024).optional(),
});

/** Cuenta cuántas variables {{1}}, {{2}}... distintas hay en el texto. */
function countTemplateVariables(text: string): number {
  const matches = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)];
  if (matches.length === 0) return 0;
  return Math.max(...matches.map((m) => Number(m[1])));
}

/**
 * Crea una plantilla de WhatsApp de verdad contra la API de Meta (no una
 * simulación) — queda "PENDING" hasta que Meta la revisa y aprueba, tal
 * como pide la revisión de la app para el permiso whatsapp_business_management.
 */
export async function createMessageTemplateAction(
  botId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  const parsed = createTemplateSchema.safeParse({
    name: formData.get("name"),
    category: formData.get("category"),
    languageCode: formData.get("languageCode"),
    bodyText: formData.get("bodyText"),
    bodyExample: formData.get("bodyExample") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const variableCount = countTemplateVariables(parsed.data.bodyText);
  const bodyExample = (parsed.data.bodyExample ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (variableCount > 0 && bodyExample.length !== variableCount) {
    return {
      error: `El texto usa ${variableCount} variable(s) ({{1}}...{{${variableCount}}}) — debes dar exactamente ${variableCount} valor(es) de ejemplo, separados por coma.`,
    };
  }

  const connection = await prisma.whatsAppConnection.findUnique({ where: { botId: bot.id } });
  if (!connection?.verified) {
    return { error: "WhatsApp no está conectado." };
  }
  if (!connection.wabaId) {
    return { error: "Esta conexión no tiene un WABA ID guardado — no se pueden crear plantillas." };
  }

  try {
    const result = await createMessageTemplate({
      wabaId: connection.wabaId,
      accessToken: decrypt(connection.accessToken),
      name: parsed.data.name,
      category: parsed.data.category as TemplateCategory,
      languageCode: parsed.data.languageCode,
      bodyText: parsed.data.bodyText,
      bodyExample: variableCount > 0 ? bodyExample : undefined,
    });
    revalidatePath("/dashboard/whatsapp");
    return {
      error: null,
      message: `Plantilla "${parsed.data.name}" enviada a revisión de Meta (estado: ${result.status}).`,
    };
  } catch (error) {
    console.error("[whatsapp] No se pudo crear la plantilla:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return { error: `No se pudo crear la plantilla en Meta: ${message}` };
  }
}

/** Borra una plantilla (todas sus variantes de idioma) de la cuenta de WhatsApp. */
export async function deleteMessageTemplateAction(
  botId: string,
  templateName: string,
): Promise<ActionState> {
  const { bot } = await requireBotOwnerAccess(botId);

  const connection = await prisma.whatsAppConnection.findUnique({ where: { botId: bot.id } });
  if (!connection?.verified || !connection.wabaId) {
    return { error: "WhatsApp no está conectado." };
  }

  try {
    await deleteMessageTemplate({
      wabaId: connection.wabaId,
      accessToken: decrypt(connection.accessToken),
      name: templateName,
    });
    revalidatePath("/dashboard/whatsapp");
    return { error: null, message: `Plantilla "${templateName}" borrada.` };
  } catch (error) {
    console.error("[whatsapp] No se pudo borrar la plantilla:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return { error: `No se pudo borrar la plantilla en Meta: ${message}` };
  }
}
