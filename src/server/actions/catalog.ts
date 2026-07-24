"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireBotAccess, HttpError } from "@/server/auth/guards";
import type { ActionState } from "./bots";

const itemSchema = z.object({
  name: z.string().min(1, "Requerido").max(120),
  description: z.string().max(2000).optional(),
  price: z.coerce.number().nonnegative("El precio debe ser positivo").optional(),
});

export async function createCatalogItemAction(
  botId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { bot } = await requireBotAccess(botId);

  const parsed = itemSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price: formData.get("price") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.catalogItem.create({ data: { botId: bot.id, ...parsed.data } });

  revalidatePath(`/dashboard/bots/${bot.id}`);
  return { error: null };
}

export async function toggleCatalogItemAction(botId: string, itemId: string) {
  const { bot } = await requireBotAccess(botId);
  const item = await prisma.catalogItem.findUnique({ where: { id: itemId } });
  if (!item || item.botId !== bot.id) throw new HttpError(404, "Producto no encontrado");

  await prisma.catalogItem.update({ where: { id: itemId }, data: { active: !item.active } });
  revalidatePath(`/dashboard/bots/${bot.id}`);
}

export async function deleteCatalogItemAction(botId: string, itemId: string) {
  const { bot } = await requireBotAccess(botId);
  const item = await prisma.catalogItem.findUnique({ where: { id: itemId } });
  if (!item || item.botId !== bot.id) throw new HttpError(404, "Producto no encontrado");

  await prisma.catalogItem.delete({ where: { id: itemId } });
  revalidatePath(`/dashboard/bots/${bot.id}`);
}
