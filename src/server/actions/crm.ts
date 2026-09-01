"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireSession } from "@/server/auth/guards";
import { audit } from "@/server/services/audit";
import { ALL_STAGES, OPEN_STAGES, type Stage } from "@/lib/pipeline";
import { analyzeFollowUp } from "@/server/services/ai/follow-up";
import { isAiEnabled, isWithinBudget, spentToday } from "@/server/services/ai/client";
import { saveMediaFile, deleteMediaFile } from "@/lib/media-storage";
import type { ActionState } from "./types";

const PATH = "/dashboard/seguimiento";

async function requireOrg() {
  const session = await requireSession();
  if (!session.user.organizationId) throw new Error("Sin organización");
  const isAdmin = session.user.role === "OWNER" || session.user.role === "SUPERADMIN";
  return {
    organizationId: session.user.organizationId,
    userId: session.user.id,
    isAdmin,
  };
}

/**
 * El vendedor solo maneja su propia cartera; lo que el admin ya cargó (o
 * dejó sin asignar) lo puede editar cualquiera que lo tome. Evita que un
 * vendedor toque las filas de otro por error o a propósito.
 */
function canEditOpportunity(
  opportunity: { assignedToId: string | null },
  userId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || opportunity.assignedToId === userId;
}

const createSchema = z
  .object({
    contactId: z.string().optional(),
    newContactName: z.string().max(160).optional(),
    newContactPhone: z.string().max(32).optional(),
    title: z.string().min(2, "Ponle un título").max(160),
    serviceInterest: z.string().max(160).optional(),
    estimatedValue: z.coerce.number().nonnegative().optional(),
    nextAction: z.string().max(300).optional(),
    nextActionAt: z.string().optional(),
  })
  .refine((d) => d.contactId || d.newContactPhone, {
    message: "Elegí un contacto o cargá el teléfono de uno nuevo",
  });

export async function createOpportunityAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState & { opportunityId?: string }> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const parsed = createSchema.safeParse({
    contactId: formData.get("contactId") || undefined,
    newContactName: formData.get("newContactName") || undefined,
    newContactPhone: formData.get("newContactPhone") || undefined,
    title: formData.get("title"),
    serviceInterest: formData.get("serviceInterest") || undefined,
    estimatedValue: formData.get("estimatedValue") || undefined,
    nextAction: formData.get("nextAction") || undefined,
    nextActionAt: formData.get("nextActionAt") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  let contactId: string;
  if (parsed.data.newContactPhone) {
    // Lead que todavía no escribió por WhatsApp: se crea el contacto acá
    // mismo. El teléfono es la misma llave que usa el webhook, así que si
    // el cliente después escribe, se engancha solo a este mismo contacto
    // en vez de duplicarse.
    const phone = parsed.data.newContactPhone.trim();
    const contact = await prisma.contact.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: {
        organizationId,
        phone,
        fullName: parsed.data.newContactName?.trim() || null,
        source: "Manual",
      },
      update: {},
    });
    contactId = contact.id;
  } else {
    const contact = await prisma.contact.findUnique({ where: { id: parsed.data.contactId! } });
    if (!contact || contact.organizationId !== organizationId) {
      return { error: "Contacto no encontrado" };
    }
    contactId = contact.id;
  }

  const created = await prisma.opportunity.create({
    data: {
      organizationId,
      contactId,
      title: parsed.data.title,
      serviceInterest: parsed.data.serviceInterest ?? null,
      estimatedValue: parsed.data.estimatedValue ?? null,
      nextAction: parsed.data.nextAction ?? null,
      nextActionAt: parsed.data.nextActionAt ? new Date(parsed.data.nextActionAt) : null,
      // El admin carga clientes para el equipo: quedan sin asignar y
      // cualquier vendedor los puede tomar. Un vendedor que agrega uno
      // propio se lo asigna directo, como ya hacía antes.
      assignedToId: isAdmin ? null : userId,
    },
  });

  await audit({
    entityType: "Opportunity",
    entityId: created.id,
    action: "create",
    userId,
    organizationId,
    after: { title: created.title, stage: created.stage },
  });

  revalidatePath(PATH);
  return { error: null, message: "Cliente agregado.", opportunityId: created.id };
}

/**
 * Guarda una celda editada en la tabla de seguimiento. Es la forma en que
 * el equipo ya trabaja en su planilla: se corrige el dato en su lugar.
 */
const fieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("stage"), value: z.enum(ALL_STAGES as [Stage, ...Stage[]]) }),
  z.object({ field: z.literal("priority"), value: z.enum(["ALTA", "MEDIA", "BAJA"]) }),
  z.object({ field: z.literal("serviceInterest"), value: z.string().max(160) }),
  z.object({ field: z.literal("needSummary"), value: z.string().max(5000) }),
  z.object({ field: z.literal("lastUpdate"), value: z.string().max(5000) }),
  z.object({ field: z.literal("nextContactAt"), value: z.string() }),
  z.object({ field: z.literal("nextAction"), value: z.string().max(300) }),
  z.object({ field: z.literal("nextActionAt"), value: z.string() }),
  z.object({ field: z.literal("probability"), value: z.coerce.number().min(0).max(100) }),
  z.object({ field: z.literal("lostReason"), value: z.string().max(500) }),
  // "" = sin asignar (lo suelta el vendedor, o el admin lo deja libre para
  // que cualquiera lo tome). Cualquier otro valor debe ser un userId real.
  z.object({ field: z.literal("assignedToId"), value: z.string().max(60) }),
]);

export async function updateOpportunityFieldAction(
  opportunityId: string,
  field: string,
  value: string,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const parsed = fieldSchema.safeParse({ field, value });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Valor inválido" };

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }

  // Reasignar tiene sus propias reglas (ver más abajo); el resto de los
  // campos solo los toca el dueño de la fila o el admin.
  if (parsed.data.field !== "assignedToId" && !canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const now = new Date();
  const data: Record<string, unknown> = {};

  switch (parsed.data.field) {
    case "stage": {
      const stage = parsed.data.value;
      data.stage = stage;
      data.wonAt = stage === "GANADO" ? now : null;
      data.lostAt = stage === "PERDIDO" ? now : null;
      // "Propuesta" es la etapa que representa preparar/mandar la cotización.
      if (stage === "PROPUESTA" && !opportunity.proposalSentAt) data.proposalSentAt = now;
      break;
    }
    case "nextContactAt":
      data.nextContactAt = parsed.data.value ? new Date(parsed.data.value) : null;
      break;
    case "nextActionAt":
      data.nextActionAt = parsed.data.value ? new Date(parsed.data.value) : null;
      break;
    case "probability":
      data.probability = Math.round(parsed.data.value);
      break;
    case "assignedToId": {
      const targetId = parsed.data.value || null;
      if (isAdmin) {
        // El admin puede asignar a cualquiera del equipo, o soltarlo.
        if (targetId) {
          const target = await prisma.user.findUnique({ where: { id: targetId } });
          if (!target || target.organizationId !== organizationId) {
            return { error: "Ese usuario no pertenece a la organización" };
          }
        }
      } else if (targetId === userId) {
        // Tomar un cliente sin asignar.
        if (opportunity.assignedToId !== null) {
          return { error: "Ya lo tomó otro vendedor" };
        }
      } else if (targetId === null) {
        // Soltar un cliente propio, vuelve a quedar libre para el equipo.
        if (opportunity.assignedToId !== userId) {
          return { error: "No puedes soltar un cliente que no es tuyo" };
        }
      } else {
        return { error: "Solo el admin puede reasignar a otro vendedor" };
      }
      data.assignedToId = targetId;
      break;
    }
    default:
      data[parsed.data.field] = parsed.data.value || null;
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data });

  // Solo se auditan los cambios de estado y de dueño: son los que después
  // explican el embudo. Auditar cada tecleo de una nota solo generaría ruido.
  if (parsed.data.field === "stage") {
    await audit({
      entityType: "Opportunity",
      entityId: opportunityId,
      action: "stage_change",
      userId,
      organizationId,
      before: { stage: opportunity.stage },
      after: { stage: parsed.data.value },
    });
  } else if (parsed.data.field === "assignedToId") {
    await audit({
      entityType: "Opportunity",
      entityId: opportunityId,
      action: "reassign",
      userId,
      organizationId,
      before: { assignedToId: opportunity.assignedToId },
      after: { assignedToId: data.assignedToId },
    });
  }

  revalidatePath(PATH);
  return { error: null };
}

export async function deleteOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.opportunity.delete({ where: { id: opportunityId } });

  await audit({
    entityType: "Opportunity",
    entityId: opportunityId,
    action: "delete",
    userId,
    organizationId,
    before: { title: opportunity.title, stage: opportunity.stage },
  });

  revalidatePath(PATH);
  return { error: null };
}

/**
 * Archivar oculta al cliente de la vista principal sin borrar nada (a
 * diferencia de "Quitar del seguimiento", que sí elimina) — para leads
 * viejos/perdidos que ya no quieres ver pero podrías necesitar consultar.
 */
export async function archiveOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data: { archivedAt: new Date() } });
  revalidatePath(PATH);
  return { error: null };
}

export async function unarchiveOpportunityAction(opportunityId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({ where: { id: opportunityId } });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.opportunity.update({ where: { id: opportunityId }, data: { archivedAt: null } });
  revalidatePath(PATH);
  return { error: null };
}

/**
 * Guarda el orden manual (arrastrar y soltar) de la cartera completa —
 * es compartida por todo el equipo, como el resto de la planilla.
 */
export async function reorderOpportunitiesAction(orderedIds: string[]): Promise<ActionState> {
  const { organizationId } = await requireOrg();

  const owned = await prisma.opportunity.findMany({
    where: { id: { in: orderedIds }, organizationId },
    select: { id: true },
  });
  if (owned.length !== orderedIds.length) {
    return { error: "Alguno de estos clientes ya no existe. Recarga la página." };
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.opportunity.update({ where: { id }, data: { sortOrder: index } }),
    ),
  );

  revalidatePath(PATH);
  return { error: null };
}

// ── Reuniones ───────────────────────────────────────────────────────────
// Registro manual de reuniones (fecha + transcripción/notas) mientras no
// haya integración automática con Meet. El asesor IA las lee como fuente
// prioritaria — declaraciones directas del lead — al calificar el lead.

// 100k caracteres ≈ 60-70 páginas de texto — de sobra para la transcripción
// literal de una reunión larga, con mensaje de error en español (antes
// caían en el texto en inglés por defecto de Zod).
const MEETING_NOTES_MAX = 100_000;
const meetingNotesField = z
  .string()
  .max(MEETING_NOTES_MAX, `Máximo ${MEETING_NOTES_MAX.toLocaleString("es")} caracteres.`);

const createMeetingSchema = z.object({
  opportunityId: z.string().min(1),
  scheduledAt: z.string().min(1, "Poné la fecha"),
  durationMinutes: z.coerce.number().int().positive().max(600).optional(),
  meetingUrl: z.string().max(500).optional(),
  notes: meetingNotesField.optional(), // transcripción o resumen de la reunión
});

export async function createMeetingAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const parsed = createMeetingSchema.safeParse({
    opportunityId: formData.get("opportunityId"),
    scheduledAt: formData.get("scheduledAt"),
    durationMinutes: formData.get("durationMinutes") || undefined,
    meetingUrl: formData.get("meetingUrl") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: parsed.data.opportunityId },
    select: { organizationId: true, assignedToId: true },
  });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) {
    return { error: "Fecha inválida" };
  }

  await prisma.meeting.create({
    data: {
      organizationId,
      opportunityId: parsed.data.opportunityId,
      scheduledAt,
      durationMinutes: parsed.data.durationMinutes ?? 30,
      meetingUrl: parsed.data.meetingUrl || null,
      notes: parsed.data.notes || null,
      status: parsed.data.notes ? "DONE" : "SCHEDULED",
    },
  });

  revalidatePath(PATH);
  return { error: null, message: "Reunión registrada." };
}

const updateMeetingNotesSchema = z.object({
  notes: meetingNotesField,
});

/** Carga o edita la transcripción/resumen de una reunión ya registrada. */
export async function updateMeetingNotesAction(
  meetingId: string,
  notes: string,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  const parsed = updateMeetingNotesSchema.safeParse({ notes });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      notes: parsed.data.notes || null,
      status: parsed.data.notes && meeting.status === "SCHEDULED" ? "DONE" : meeting.status,
    },
  });

  revalidatePath(PATH);
  return { error: null };
}

export async function deleteMeetingAction(meetingId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } }, attachments: true },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.meeting.delete({ where: { id: meetingId } });
  await Promise.all(meeting.attachments.map((a) => deleteMediaFile(a.url)));
  revalidatePath(PATH);
  return { error: null };
}

// Mismos límites que ya usa el inbox para adjuntos salientes — ver
// MAX_SIZE_BY_TYPE en server/actions/inbox.ts.
const MEETING_ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;
const MEETING_ATTACHMENTS_PER_MEETING = 20;

/** Sube uno o más archivos (audio, PDF, capturas) ligados a una reunión. */
export async function addMeetingAttachmentAction(
  meetingId: string,
  formData: FormData,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: { opportunity: { select: { assignedToId: true } }, _count: { select: { attachments: true } } },
  });
  if (!meeting || meeting.organizationId !== organizationId) {
    return { error: "Reunión no encontrada" };
  }
  if (meeting.opportunity && !canEditOpportunity(meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }
  if (meeting._count.attachments >= MEETING_ATTACHMENTS_PER_MEETING) {
    return { error: `Máximo ${MEETING_ATTACHMENTS_PER_MEETING} archivos por reunión.` };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { error: "Archivo inválido" };
  }
  if (file.size > MEETING_ATTACHMENT_MAX_BYTES) {
    return { error: "El archivo supera el límite de 100MB." };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const url = await saveMediaFile(buffer, mimeType);

  await prisma.meetingAttachment.create({
    data: { meetingId, url, fileName: file.name, mimeType, fileSize: file.size },
  });

  revalidatePath(PATH);
  return { error: null };
}

export async function deleteMeetingAttachmentAction(attachmentId: string): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const attachment = await prisma.meetingAttachment.findUnique({
    where: { id: attachmentId },
    include: { meeting: { include: { opportunity: { select: { assignedToId: true } } } } },
  });
  if (!attachment || attachment.meeting.organizationId !== organizationId) {
    return { error: "Archivo no encontrado" };
  }
  if (attachment.meeting.opportunity && !canEditOpportunity(attachment.meeting.opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  await prisma.meetingAttachment.delete({ where: { id: attachmentId } });
  await deleteMediaFile(attachment.url);

  revalidatePath(PATH);
  return { error: null };
}

export async function completeActivityAction(activityId: string): Promise<ActionState> {
  const { organizationId, userId } = await requireOrg();

  const activity = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!activity || activity.organizationId !== organizationId) {
    return { error: "Tarea no encontrada" };
  }

  await prisma.activity.update({
    where: { id: activityId },
    data: { status: "DONE", completedAt: new Date() },
  });

  await audit({
    entityType: "Activity",
    entityId: activityId,
    action: "complete",
    userId,
    organizationId,
  });

  revalidatePath(PATH);
  return { error: null };
}

/** Clientes activos sin próximo contacto agendado. */
export async function countWithoutNextContact(organizationId: string): Promise<number> {
  return prisma.opportunity.count({
    where: {
      organizationId,
      stage: { in: OPEN_STAGES },
      nextContactAt: null,
    },
  });
}

/**
 * Pide un análisis del asesor IA para un cliente. Se ejecuta al momento
 * (no encolado) porque el vendedor está esperando el resultado en pantalla.
 */
export async function analyzeOpportunityAction(
  opportunityId: string,
): Promise<ActionState> {
  const { organizationId, userId, isAdmin } = await requireOrg();

  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    select: { organizationId: true, assignedToId: true },
  });
  if (!opportunity || opportunity.organizationId !== organizationId) {
    return { error: "Cliente no encontrado" };
  }
  if (!canEditOpportunity(opportunity, userId, isAdmin)) {
    return { error: "Este cliente está asignado a otro vendedor." };
  }

  if (!isAiEnabled()) {
    return { error: "El asesor IA no está configurado. Falta OPENAI_API_KEY." };
  }

  if (!(await isWithinBudget(organizationId))) {
    return {
      error: "Se alcanzó el tope de gasto diario de IA. Vuelve a intentar mañana.",
    };
  }

  try {
    await analyzeFollowUp(opportunityId);
  } catch (error) {
    console.error("[crm] Falló el análisis:", error);
    return { error: "No se pudo analizar. Intenta de nuevo en un momento." };
  }

  revalidatePath(PATH);
  return { error: null, message: "Análisis listo." };
}

/** Gasto de IA de hoy, para mostrarlo junto al tope configurado. */
export async function getAiSpendToday(organizationId: string) {
  return {
    spent: await spentToday(organizationId),
    budget: Number(process.env.AI_DAILY_BUDGET_USD ?? 2),
    enabled: isAiEnabled(),
  };
}
