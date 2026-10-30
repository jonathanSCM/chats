"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { AiBudgetExceededError, AiCreditsError, isAiEnabledFor } from "@/server/services/ai/client";
import { proposeKnowledgeChanges, type ChatTurn } from "@/server/services/ai/knowledge-editor";
import {
  MAX_CHANGES,
  MAX_PROMPT_CHARS,
  proposedChangeSchema,
  validateChanges,
  type ItemSnapshot,
  type KnowledgeCategoryKey,
  type ProposedChange,
} from "@/lib/knowledge-editor";
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

// ─── Editor con IA ───────────────────────────────────────────────────────
// La IA propone; una persona aprueba. Cada cambio aplicado queda en la
// auditoría con su antes y su después, y se puede revertir.

export interface KnowledgeProposalResult {
  error: string | null;
  message: string;
  clarification: string | null;
  changes: ProposedChange[];
  dropped: string[];
}

const instructionSchema = z.string().trim().min(3, "Escribí qué querés cambiar").max(2000);
const historySchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(3000) }))
  .max(12);

function snapshotOf(item: {
  id: string;
  category: string;
  title: string;
  content: string;
  active: boolean;
  version: number;
}): ItemSnapshot {
  return { ...item, category: item.category as KnowledgeCategoryKey };
}

/** Pide a la IA cambios concretos para la instrucción dada. No escribe nada. */
export async function proposeKnowledgeChangesAction(
  instruction: string,
  history: ChatTurn[],
): Promise<KnowledgeProposalResult> {
  const empty = { message: "", clarification: null, changes: [], dropped: [] };
  const { organizationId, userId } = await requireKnowledgeEditor();

  const parsedInstruction = instructionSchema.safeParse(instruction);
  if (!parsedInstruction.success) {
    return { ...empty, error: parsedInstruction.error.issues[0]?.message ?? "Pedido inválido" };
  }
  const parsedHistory = historySchema.safeParse(history);
  if (!parsedHistory.success) return { ...empty, error: "La conversación es demasiado larga. Empezá una nueva." };
  if (!(await isAiEnabledFor(organizationId))) return { ...empty, error: "La IA no está configurada en el servidor." };

  const rows = await prisma.knowledgeItem.findMany({
    where: { organizationId },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
  const items = rows.map(snapshotOf);
  if (items.reduce((n, i) => n + i.content.length + i.title.length, 0) > MAX_PROMPT_CHARS) {
    return {
      ...empty,
      error: "La base de conocimiento es demasiado extensa para el editor. Desactivá o resumí entradas viejas.",
    };
  }

  let proposal;
  try {
    proposal = await proposeKnowledgeChanges({
      organizationId,
      userId,
      instruction: parsedInstruction.data,
      history: parsedHistory.data,
      items,
    });
  } catch (error) {
    if (error instanceof AiCreditsError) return { ...empty, error: error.message };
    if (error instanceof AiBudgetExceededError) {
      return { ...empty, error: "Se alcanzó el tope de gasto diario de IA. Probá de nuevo mañana." };
    }
    console.error("[knowledge-editor] Error de IA:", error);
    return { ...empty, error: "No se pudo consultar a la IA. Probá de nuevo en un momento." };
  }

  const { changes, dropped } = validateChanges(proposal.changes, items);
  return {
    error: null,
    message: proposal.message,
    clarification: proposal.needsClarification,
    changes,
    dropped,
  };
}

class ConflictError extends Error {}

/** Aplica solo los cambios que la persona aprobó. Revalida todo contra la base actual. */
export async function applyKnowledgeChangesAction(
  input: unknown,
): Promise<ActionState & { applied?: number }> {
  const { organizationId, userId } = await requireKnowledgeEditor();

  const parsed = z.array(proposedChangeSchema).min(1).max(MAX_CHANGES).safeParse(input);
  if (!parsed.success) return { error: "Los cambios no son válidos. Pedilos de nuevo." };

  const batchId = `kb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const records: {
    entityId: string;
    action: string;
    before: unknown;
    after: unknown;
  }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      for (const c of parsed.data) {
        if (c.action === "create") {
          const created = await tx.knowledgeItem.create({
            data: {
              organizationId,
              category: c.category,
              title: c.title,
              content: c.content,
              updatedById: userId,
            },
          });
          records.push({
            entityId: created.id,
            action: "ai_edit_create",
            before: null,
            after: { category: c.category, title: c.title, content: c.content, active: true, version: created.version, batchId, reason: c.reason },
          });
          continue;
        }

        const item = c.itemId ? await tx.knowledgeItem.findUnique({ where: { id: c.itemId } }) : null;
        if (!item || item.organizationId !== organizationId) throw new ConflictError("Entrada no encontrada");
        if (item.version !== c.baseVersion) {
          throw new ConflictError(`"${item.title}" cambió mientras revisabas. Pedí el cambio de nuevo.`);
        }
        const before = {
          category: item.category,
          title: item.title,
          content: item.content,
          active: item.active,
          version: item.version,
        };

        const data =
          c.action === "update"
            ? { category: c.category, title: c.title, content: c.content }
            : { active: c.action === "activate" };
        const updated = await tx.knowledgeItem.update({
          where: { id: item.id },
          data: { ...data, updatedById: userId, version: { increment: 1 } },
        });
        records.push({
          entityId: item.id,
          action: `ai_edit_${c.action}`,
          before,
          after: {
            category: updated.category,
            title: updated.title,
            content: updated.content,
            active: updated.active,
            version: updated.version,
            batchId,
            reason: c.reason,
          },
        });
      }
    });
  } catch (error) {
    if (error instanceof ConflictError) return { error: error.message };
    console.error("[knowledge-editor] Error aplicando cambios:", error);
    return { error: "No se pudieron aplicar los cambios." };
  }

  for (const r of records) {
    await audit({
      entityType: "KnowledgeItem",
      entityId: r.entityId,
      action: r.action,
      userId,
      organizationId,
      before: r.before,
      after: r.after,
    });
  }

  revalidatePath("/dashboard/knowledge");
  return { error: null, message: `${records.length} cambio${records.length === 1 ? "" : "s"} aplicado${records.length === 1 ? "" : "s"}.`, applied: records.length };
}

/** Deshace un cambio hecho con el editor, solo si la entrada no cambió después. */
export async function revertKnowledgeChangeAction(auditId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireKnowledgeEditor();

  const log = await prisma.auditLog.findUnique({ where: { id: auditId } });
  if (
    !log ||
    log.organizationId !== organizationId ||
    log.entityType !== "KnowledgeItem" ||
    !log.action.startsWith("ai_edit_") ||
    log.action === "ai_edit_revert"
  ) {
    return { error: "Cambio no encontrado" };
  }

  const already = await prisma.auditLog.findFirst({
    where: {
      organizationId,
      entityType: "KnowledgeItem",
      action: "ai_edit_revert",
      after: { path: ["revertedAuditId"], equals: auditId },
    },
    select: { id: true },
  });
  if (already) return { error: "Este cambio ya se revirtió." };

  type Snap = { category: KnowledgeCategoryKey; title: string; content: string; active: boolean; version: number };
  const before = log.before as Snap | null;
  const after = log.after as (Snap & { batchId?: string }) | null;
  if (!after) return { error: "No hay datos para revertir este cambio." };

  const item = await prisma.knowledgeItem.findUnique({ where: { id: log.entityId } });
  if (!item || item.organizationId !== organizationId) return { error: "La entrada ya no existe." };
  if (item.version !== after.version) {
    return { error: "La entrada se modificó después de este cambio; no se puede revertir automáticamente." };
  }

  if (log.action === "ai_edit_create") {
    await prisma.knowledgeItem.delete({ where: { id: item.id } });
  } else if (before) {
    await prisma.knowledgeItem.update({
      where: { id: item.id },
      data: {
        category: before.category,
        title: before.title,
        content: before.content,
        active: before.active,
        updatedById: userId,
        version: { increment: 1 },
      },
    });
  } else {
    return { error: "No hay datos para revertir este cambio." };
  }

  await audit({
    entityType: "KnowledgeItem",
    entityId: log.entityId,
    action: "ai_edit_revert",
    userId,
    organizationId,
    before: after,
    after: { revertedAuditId: auditId, restoredFrom: log.action },
  });

  revalidatePath("/dashboard/knowledge");
  return { error: null, message: "Cambio revertido." };
}
