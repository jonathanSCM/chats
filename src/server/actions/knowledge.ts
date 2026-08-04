"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import type { ActionState } from "./types";

const CATEGORIES = [
  "SERVICE",
  "PRICING",
  "SCOPE",
  "EXCLUSION",
  "FAQ",
  "POLICY",
  "CASE_STUDY",
  "QUALIFICATION",
  "TONE",
] as const;

const itemSchema = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().min(2, "Ponle un título").max(160),
  content: z.string().min(2, "El contenido no puede estar vacío").max(20000),
});

// Solo OWNER/SUPERADMIN editan el conocimiento: es lo que la IA cita como
// verdad de la empresa, no debería poder tocarlo cualquier vendedor.
async function requireKnowledgeEditor() {
  const session = await requireSession();
  const isEditor = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  if (!isEditor || !session.user.organizationId) {
    throw new Error("Solo el administrador puede editar la base de conocimiento");
  }
  return { organizationId: session.user.organizationId, userId: session.user.id };
}

export async function createKnowledgeItemAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireKnowledgeEditor();

  const parsed = itemSchema.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.knowledgeItem.create({
    data: { ...parsed.data, organizationId, updatedById: userId },
  });

  revalidatePath("/dashboard/knowledge");
  return { error: null, message: "Entrada agregada." };
}

export async function updateKnowledgeItemAction(
  itemId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId } = await requireKnowledgeEditor();

  const parsed = itemSchema.safeParse({
    category: formData.get("category"),
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const item = await prisma.knowledgeItem.findUnique({ where: { id: itemId } });
  if (!item || item.organizationId !== organizationId) {
    return { error: "Entrada no encontrada" };
  }

  await prisma.knowledgeItem.update({
    where: { id: itemId },
    // version sube en cada edición: el manual pide saber qué versión del
    // conocimiento usó cada análisis.
    data: { ...parsed.data, updatedById: userId, version: { increment: 1 } },
  });

  revalidatePath("/dashboard/knowledge");
  return { error: null, message: "Entrada actualizada." };
}

export async function toggleKnowledgeItemAction(
  itemId: string,
  active: boolean,
): Promise<ActionState> {
  const { organizationId } = await requireKnowledgeEditor();

  const item = await prisma.knowledgeItem.findUnique({ where: { id: itemId } });
  if (!item || item.organizationId !== organizationId) {
    return { error: "Entrada no encontrada" };
  }

  await prisma.knowledgeItem.update({ where: { id: itemId }, data: { active } });
  revalidatePath("/dashboard/knowledge");
  return { error: null };
}

export async function deleteKnowledgeItemAction(itemId: string): Promise<ActionState> {
  const { organizationId } = await requireKnowledgeEditor();

  const item = await prisma.knowledgeItem.findUnique({ where: { id: itemId } });
  if (!item || item.organizationId !== organizationId) {
    return { error: "Entrada no encontrada" };
  }

  await prisma.knowledgeItem.delete({ where: { id: itemId } });
  revalidatePath("/dashboard/knowledge");
  return { error: null };
}
