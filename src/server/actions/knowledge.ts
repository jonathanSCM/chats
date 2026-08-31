"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
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

const MAX_PDF_SIZE = 15 * 1024 * 1024;

/**
 * Extrae el texto de un PDF para precargar el campo "Contenido" — así se
 * puede subir el PDF directo en vez de copiar y pegar a mano (que rompe
 * emojis y otros caracteres especiales cuando el visor de PDF no los copia
 * bien).
 */
export async function extractPdfTextAction(
  formData: FormData,
): Promise<ActionState & { text?: string }> {
  await requireKnowledgeEditor();

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Subí un archivo PDF" };
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { error: "Solo se aceptan archivos PDF" };
  }
  if (file.size > MAX_PDF_SIZE) {
    return { error: "El PDF pesa más de 15MB" };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    if (!text) {
      return { error: "No se pudo extraer texto de este PDF (¿es una imagen escaneada?)" };
    }
    return { error: null, text: text.slice(0, 20000) };
  } catch (error) {
    console.error("[knowledge] Error extrayendo texto del PDF:", error);
    return { error: "No se pudo leer este PDF" };
  } finally {
    await parser.destroy();
  }
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
