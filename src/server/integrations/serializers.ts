import { iso } from "./http";

// Cada serializador arma el objeto campo por campo (lista blanca): nunca se
// vuelcan filas completas de Prisma, así un campo nuevo sensible (tokens, etc.)
// no se filtra por accidente. Opcionales ausentes → null, no se omiten.

type Dec = { toString(): string } | number | string | null | undefined;
const num = (v: Dec): number | null => (v === null || v === undefined ? null : Number(v.toString()));

export function serializeActivity(a: {
  id: string;
  type: string;
  title: string;
  description: string | null;
  dueAt: Date | null;
  assignedToId: string | null;
  opportunityId: string | null;
  contactId: string | null;
  source: string;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    description: a.description,
    dueAt: iso(a.dueAt),
    assignedToId: a.assignedToId,
    opportunityId: a.opportunityId,
    contactId: a.contactId,
    source: a.source,
    status: a.status,
    completedAt: iso(a.completedAt),
    createdAt: a.createdAt.toISOString(),
  };
}

export function serializeOpportunity(o: {
  id: string;
  title: string;
  contactId: string;
  assignedToId: string | null;
  priority: string | null;
  estimatedValue: Dec;
  currency: string;
  nextAction: string | null;
  nextActionAt: Date | null;
  updatedAt: Date;
  stage: { label: string };
}) {
  return {
    id: o.id,
    title: o.title,
    contactId: o.contactId,
    assignedToId: o.assignedToId,
    stageLabel: o.stage.label,
    priority: o.priority,
    estimatedValue: num(o.estimatedValue),
    currency: o.currency,
    nextAction: o.nextAction,
    nextActionAt: iso(o.nextActionAt),
    updatedAt: o.updatedAt.toISOString(),
  };
}

export function serializeMeeting(m: {
  id: string;
  title: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  status: string;
  opportunityId: string | null;
  transcript: string | null;
  audioTranscript: string | null;
  notes: string | null;
  aiSummary: string | null;
  aiSummaryData: unknown;
  aiSummaryAt: Date | null;
  guestEmails: string[];
  updatedAt: Date;
}) {
  return {
    id: m.id,
    title: m.title?.trim() || "Reunión",
    scheduledAt: m.scheduledAt.toISOString(),
    durationMinutes: m.durationMinutes,
    status: m.status,
    opportunityId: m.opportunityId,
    transcript: m.transcript,
    audioTranscript: m.audioTranscript,
    notes: m.notes,
    aiSummary: m.aiSummary,
    aiSummaryData: m.aiSummaryData ?? null,
    aiSummaryAt: iso(m.aiSummaryAt),
    attendees: m.guestEmails,
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** Texto de un mensaje: vacío (media pura) → null. */
export function serializeMessage(m: {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  mediaType: string | null;
  isVoiceNote: boolean;
  fileName: string | null;
  createdAt: Date;
}) {
  const text = m.content?.trim();
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    text: text ? m.content : null,
    mediaType: m.mediaType,
    isVoiceNote: m.isVoiceNote,
    fileName: m.fileName,
    createdAt: m.createdAt.toISOString(),
  };
}
