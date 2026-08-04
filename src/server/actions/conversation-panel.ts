"use server";

import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import type { ActionState } from "./types";

/**
 * Un vendedor solo opera sobre lo suyo o lo que no tiene dueño; el admin
 * sobre todo. Misma regla que la bandeja, en un solo lugar.
 */
async function requireConversationAccess(conversationId: string) {
  const session = await requireSession();
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { bot: { select: { organizationId: true } } },
  });

  if (!conversation || conversation.bot.organizationId !== session.user.organizationId) {
    return null;
  }

  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  const isMine = !conversation.assignedToId || conversation.assignedToId === session.user.id;
  if (!isAdmin && !isMine) return null;

  return { session, conversation, organizationId: conversation.bot.organizationId };
}

const noteSchema = z.object({ body: z.string().min(1, "La nota está vacía").max(5000) });

export async function addConversationNoteAction(
  conversationId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const access = await requireConversationAccess(conversationId);
  if (!access) return { error: "Conversación no encontrada" };

  const parsed = noteSchema.safeParse({ body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.conversationNote.create({
    data: {
      conversationId,
      userId: access.session.user.id,
      body: parsed.data.body,
    },
  });

  return { error: null, message: "Nota guardada." };
}

export async function deleteConversationNoteAction(noteId: string): Promise<ActionState> {
  const session = await requireSession();

  const note = await prisma.conversationNote.findUnique({
    where: { id: noteId },
    include: { conversation: { include: { bot: { select: { organizationId: true } } } } },
  });
  if (!note || note.conversation.bot.organizationId !== session.user.organizationId) {
    return { error: "Nota no encontrada" };
  }

  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  if (note.userId !== session.user.id && !isAdmin) {
    return { error: "Solo puedes borrar tus propias notas" };
  }

  await prisma.conversationNote.delete({ where: { id: noteId } });
  return { error: null };
}

const statusSchema = z.enum(["OPEN", "ON_HOLD", "CLOSED"]);

export async function setConversationStatusAction(
  conversationId: string,
  status: "OPEN" | "ON_HOLD" | "CLOSED",
): Promise<ActionState> {
  const access = await requireConversationAccess(conversationId);
  if (!access) return { error: "Conversación no encontrada" };

  const parsed = statusSchema.safeParse(status);
  if (!parsed.success) return { error: "Estado inválido" };

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: parsed.data },
  });

  await audit({
    entityType: "Conversation",
    entityId: conversationId,
    action: "status_change",
    userId: access.session.user.id,
    organizationId: access.organizationId,
    before: { status: access.conversation.status },
    after: { status: parsed.data },
  });

  return { error: null };
}

const tagsSchema = z.array(z.string().min(1).max(40)).max(10);

export async function setConversationTagsAction(
  conversationId: string,
  tags: string[],
): Promise<ActionState> {
  const access = await requireConversationAccess(conversationId);
  if (!access) return { error: "Conversación no encontrada" };

  // Se normalizan a mayúsculas y sin repetidos: el equipo ya escribe
  // "AGENTES IA" o "SISTEMAS", y así no aparecen tres variantes de lo mismo.
  const normalized = [...new Set(tags.map((t) => t.trim().toUpperCase()).filter(Boolean))];

  const parsed = tagsSchema.safeParse(normalized);
  if (!parsed.success) return { error: "Máximo 10 etiquetas de 40 caracteres" };

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { tags: parsed.data },
  });

  return { error: null };
}

/**
 * Pasa la conversación a otro vendedor. Hasta ahora solo existía la
 * auto-asignación al primero que respondía, sin forma de corregirla.
 */
export async function transferConversationAction(
  conversationId: string,
  userId: string | null,
): Promise<ActionState> {
  const access = await requireConversationAccess(conversationId);
  if (!access) return { error: "Conversación no encontrada" };

  if (userId) {
    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target || target.organizationId !== access.organizationId) {
      return { error: "Ese usuario no está en tu equipo" };
    }
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { assignedToId: userId },
  });

  await audit({
    entityType: "Conversation",
    entityId: conversationId,
    action: userId ? "transfer" : "unassign",
    userId: access.session.user.id,
    organizationId: access.organizationId,
    before: { assignedToId: access.conversation.assignedToId },
    after: { assignedToId: userId },
  });

  return { error: null };
}

const contactSchema = z.object({
  fullName: z.string().max(120).optional(),
  email: z.string().email("Correo inválido").optional().or(z.literal("")),
  city: z.string().max(80).optional(),
  jobTitle: z.string().max(80).optional(),
});

export async function updateContactAction(
  contactId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await requireSession();

  const contact = await prisma.contact.findUnique({ where: { id: contactId } });
  if (!contact || contact.organizationId !== session.user.organizationId) {
    return { error: "Contacto no encontrado" };
  }

  const parsed = contactSchema.safeParse({
    fullName: formData.get("fullName") || undefined,
    email: formData.get("email") || undefined,
    city: formData.get("city") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      fullName: parsed.data.fullName || null,
      email: parsed.data.email || null,
      city: parsed.data.city || null,
      jobTitle: parsed.data.jobTitle || null,
    },
  });

  return { error: null, message: "Contacto actualizado." };
}
