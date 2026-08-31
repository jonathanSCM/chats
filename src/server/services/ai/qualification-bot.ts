import { z } from "zod";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { sendTextMessage } from "@/server/services/whatsapp";
import { notifyNewMessage } from "@/server/services/push";
import { isOpenStage } from "@/lib/pipeline";
import { getMeetingSlots, type MeetingSlot } from "@/lib/meeting-slots";
import { MODELS, runStructured } from "./client";

export const PROMPT_VERSION = "bot-calificacion-v1";

// Tope duro independiente de lo que devuelva el modelo: si después de esta
// cantidad de mensajes del bot todavía no se pudo calificar, se escala solo
// — defensa en profundidad contra un loop que no avanza (manual §36).
const MAX_BOT_MESSAGES = 12;

const resultSchema = z.object({
  // Mensaje a mandar al cliente. Cadena vacía si no corresponde mandar nada
  // (ej. al escalar sin despedida, o si ya se mandó todo lo necesario).
  respuesta: z.string(),
  // Cada uno: lo que se aprendió de nuevo ESTE turno, o "" si nada cambió.
  a_que_se_dedica: z.string(),
  que_quiere_mejorar: z.string(),
  como_lo_hacen_hoy: z.string(),
  problema_principal: z.string(),
  rol_contacto: z.string(),
  empresa_funcionando: z.enum(["SI", "NO", "DESCONOCIDO"]),
  listo_para_agendar: z.boolean(),
  // Cuál de las franjas ofrecidas en el input (A/B/C) eligió el cliente
  // este turno. "" si todavía no corresponde ofrecer horarios, o si el
  // cliente no eligió ninguna.
  reunion_elegida: z.enum(["", "A", "B", "C"]),
  debe_escalar: z.boolean(),
  motivo_escalar: z.string(), // "" si no aplica
  memoria: z.string(),
});

export type QualificationResult = z.infer<typeof resultSchema>;

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "respuesta",
    "a_que_se_dedica",
    "que_quiere_mejorar",
    "como_lo_hacen_hoy",
    "problema_principal",
    "rol_contacto",
    "empresa_funcionando",
    "listo_para_agendar",
    "reunion_elegida",
    "debe_escalar",
    "motivo_escalar",
    "memoria",
  ],
  properties: {
    respuesta: {
      type: "string",
      description:
        "Mensaje de WhatsApp a mandar al cliente ahora, siguiendo la GUÍA DE CALIFICACIÓN y el TONO de " +
        "abajo. Una sola pregunta o idea por mensaje. Cadena vacía solo si de verdad no corresponde " +
        "mandar nada este turno.",
    },
    a_que_se_dedica: { type: "string", description: "Rubro/actividad de la empresa, si se aprendió algo nuevo. \"\" si no." },
    que_quiere_mejorar: { type: "string", description: "Qué quiere mejorar, si se aprendió algo nuevo. \"\" si no." },
    como_lo_hacen_hoy: { type: "string", description: "Cómo lo hacen actualmente, si se aprendió algo nuevo. \"\" si no." },
    problema_principal: { type: "string", description: "Problema concreto que genera trabajar así, si se aprendió algo nuevo. \"\" si no." },
    rol_contacto: { type: "string", description: "Función de la persona en la empresa, si se aprendió algo nuevo. \"\" si no." },
    empresa_funcionando: {
      type: "string",
      enum: ["SI", "NO", "DESCONOCIDO"],
      description: "Si por lo hablado hasta ahora hay una empresa real y funcionando.",
    },
    listo_para_agendar: {
      type: "boolean",
      description:
        "true solo cuando ya hay empresa real + problema real + posible mejora con tecnología, y " +
        "corresponde ofrecer o confirmar la reunión de diagnóstico.",
    },
    reunion_elegida: {
      type: "string",
      enum: ["", "A", "B", "C"],
      description:
        "Si en la CONVERSACIÓN el cliente ya eligió una de las FRANJAS DISPONIBLES ofrecidas más abajo, " +
        "la letra de esa franja (A, B o C). \"\" si todavía no se ofrecieron franjas, o el cliente no " +
        "eligió ninguna todavía.",
    },
    debe_escalar: {
      type: "boolean",
      description:
        "true si el bot debe dejar de responder y pasar la conversación a un humano: el cliente pide " +
        "hablar con una persona, hace una pregunta que el bot no puede responder con lo que sabe, se " +
        "queja, o la conversación no está avanzando.",
    },
    motivo_escalar: {
      type: "string",
      description: "Por qué se escala, en una frase para el vendedor. \"\" si debe_escalar es false.",
    },
    memoria: {
      type: "string",
      description:
        "Resumen actualizado de todo lo importante que se sabe de este lead hasta ahora (rubro, qué " +
        "quiere mejorar, cómo lo hacen hoy, problema, rol del contacto, si aceptó o no la reunión). " +
        "Parte de la MEMORIA ANTERIOR si existe y corrígela/ampliala con lo nuevo — no la repitas igual " +
        "si no cambió nada. Texto libre, breve (máximo ~6 líneas), sin inventar datos.",
    },
  },
} as const;

const SYSTEM = `Eres el bot de WhatsApp que filtra los primeros mensajes de un lead antes de que lo atienda un vendedor.

Reglas duras, siempre:
- Formato del mensaje: como una persona escribiendo por WhatsApp, no un párrafo corrido. Si hay más de
  una idea (saludo, contexto, la pregunta), separalas en líneas distintas con un salto de línea entre
  cada una. Ejemplo del primer mensaje de la conversación:
  "Hola 👋 Soy el asistente de ProShop.
  Ayudamos a las empresas a trabajar mejor usando tecnología.
  Para entender cómo podemos ayudarte: ¿qué parte de tu empresa te gustaría mejorar o hacer más fácil?"
  A partir del segundo mensaje ya no hace falta saludar de nuevo ni repetir quién sos.
- Podés usar un emoji simple y de uso común (👋 👍 🙂) de vez en cuando si suma calidez, nunca más de
  uno por mensaje y nunca en mensajes serios (escalamiento, quejas). No es obligatorio.
- Una sola pregunta o idea por mensaje. Nunca combines varias preguntas en un "respuesta".
- Usa lo que el cliente ya explicó, aunque lo haya contado de pasada al responder otra pregunta. Si un
  dato ya se sabe (por la conversación o por la MEMORIA ANTERIOR) no lo vuelvas a preguntar ni pidas más
  detalle sobre algo que ya quedó claro — avanza directo a lo que todavía falta.
- No inventes información que el cliente no dio.
- No ofrezcas ni menciones soluciones concretas de ProShop todavía — eso se hace en la reunión de diagnóstico.
- No hagas el diagnóstico completo por WhatsApp (presupuesto, volumen exacto, decisor, urgencia, etc.):
  esas preguntas son para la reunión, no para acá.
- Si el cliente hace una pregunta directa, respóndela en una frase y vuelve de forma natural al filtro.
- Si el cliente pide hablar con una persona, se queja, o hace algo que esta guía no cubre, pon
  debe_escalar en true y deja de insistir con preguntas.
- Primero invita a la reunión de diagnóstico en general (sin mencionar horarios) y espera a que el
  cliente acepte. Recién cuando el cliente ya dijo que sí quiere agendar, ofrécele las FRANJAS
  DISPONIBLES de abajo en tu "respuesta" (con palabras naturales, ej. "lunes a las 10 o miércoles a las
  3pm, ¿cuál te queda mejor?"), y marca en "reunion_elegida" la que el cliente elija apenas la mencione.
- No inventes ni ofrezcas ningún horario que no esté en FRANJAS DISPONIBLES.
- El guion exacto de preguntas, cuándo agendar, cuándo no agendar, y el estilo de conversación están en
  la GUÍA DE CALIFICACIÓN y el TONO de la Base de Conocimiento de abajo — síguelos al pie de la letra.
  Si no hay ninguna guía cargada, usa como referencia general: entender a qué se dedica la empresa, qué
  quiere mejorar, cómo lo hacen hoy, qué problema real les genera, y qué función tiene el contacto —
  siempre de a una pregunta por vez, sin vender antes de tiempo.
- Devuelve exclusivamente el JSON del esquema pedido.`;

interface ConversationForBot {
  id: string;
  organizationId: string;
  botPaused: boolean;
  botMemory: string | null;
  assignedToId: string | null;
  customerName: string | null;
  customerPhone: string;
  phoneNumberId: string;
  accessToken: string;
  aiQualificationEnabled: boolean;
  aiTestPhone: string | null;
  contact: { id: string; fullName: string | null; phone: string; jobTitle: string | null } | null;
}

async function loadConversation(conversationId: string): Promise<ConversationForBot | null> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      bot: { include: { organization: true, whatsappConnection: true } },
      contact: { select: { id: true, fullName: true, phone: true, jobTitle: true } },
    },
  });
  if (!conversation || !conversation.bot.whatsappConnection?.verified) return null;

  return {
    id: conversation.id,
    organizationId: conversation.bot.organizationId,
    botPaused: conversation.botPaused,
    botMemory: conversation.botMemory,
    assignedToId: conversation.assignedToId,
    customerName: conversation.customerName,
    customerPhone: conversation.customerPhone,
    phoneNumberId: conversation.bot.whatsappConnection.phoneNumberId,
    accessToken: conversation.bot.whatsappConnection.accessToken,
    aiQualificationEnabled: conversation.bot.aiQualificationEnabled,
    aiTestPhone: conversation.bot.aiTestPhone,
    contact: conversation.contact,
  };
}

/**
 * Arma el contexto que se le manda al modelo: la guía de calificación y el
 * tono (Base de Conocimiento), la memoria acumulada y la conversación
 * reciente. Mismo patrón que buildInput() en follow-up.ts.
 */
async function buildInput(conversation: ConversationForBot, slots: MeetingSlot[]): Promise<string> {
  const [knowledge, recentMessages] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { organizationId: conversation.organizationId, active: true },
      select: { category: true, title: true, content: true },
      orderBy: { category: "asc" },
      take: 40,
    }),
    prisma.message.findMany({
      where: { conversationId: conversation.id, role: { in: ["CUSTOMER", "BOT"] } },
      select: { role: true, content: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const qualificationItems = knowledge.filter((k) => k.category === "QUALIFICATION");
  const toneItems = knowledge.filter((k) => k.category === "TONE");

  const qualificationText = qualificationItems.length
    ? qualificationItems.map((k) => `${k.title}\n${k.content}`).join("\n\n---\n\n")
    : "(No hay ninguna guía cargada. Usa la referencia general del SYSTEM.)";

  const toneText = toneItems.length
    ? toneItems.map((k) => `${k.title}\n${k.content}`).join("\n\n---\n\n")
    : "(No hay tono cargado. Usa un tono cercano, sencillo y profesional.)";

  const conversationText = recentMessages.length
    ? recentMessages
        .slice()
        .reverse()
        .map((m) => `${m.role === "CUSTOMER" ? "Cliente" : "Bot"}: ${m.content}`)
        .join("\n")
    : "(Sin mensajes previos — es el primer mensaje de esta conversación.)";

  const letters = ["A", "B", "C"] as const;
  const slotsText = slots
    .map((slot, i) => `${letters[i]}) ${slot.label}`)
    .join("\n");

  return `FECHA DE HOY: ${new Date().toISOString().slice(0, 10)}

CLIENTE
Nombre de perfil de WhatsApp: ${conversation.customerName ?? "(desconocido)"}
Teléfono: ${conversation.customerPhone}

MEMORIA ANTERIOR (resumen acumulado de esta conversación — actualízala, no la ignores)
${conversation.botMemory ?? "(Todavía no hay memoria — es el primer turno.)"}

FRANJAS DISPONIBLES para la reunión de diagnóstico (solo ofrécelas si el cliente ya aceptó agendar)
${slotsText}

CONVERSACIÓN DE WHATSAPP (más reciente al final)
${conversationText}

GUÍA DE CALIFICACIÓN (obligatoria)
${qualificationText}

TONO DE CONVERSACIÓN (obligatorio)
${toneText}`;
}

/**
 * Crea la Opportunity cuando el bot detecta que el lead califica, si el
 * contacto todavía no tiene ninguna abierta. Mismo shape que arma
 * createOpportunityAction en actions/crm.ts, para que aparezca en
 * Seguimiento sin tocar el pipeline existente.
 */
async function ensureOpportunity(
  conversation: ConversationForBot,
  result: QualificationResult,
): Promise<string | null> {
  if (!conversation.contact) return null;

  const existingOpen = await prisma.opportunity.findFirst({
    where: { contactId: conversation.contact.id, archivedAt: null },
    select: { id: true, stage: true },
  });
  if (existingOpen && isOpenStage(existingOpen.stage)) return existingOpen.id;

  const needSummary = [result.problema_principal, result.que_quiere_mejorar]
    .filter(Boolean)
    .join(" — ") || result.memoria;

  const created = await prisma.opportunity.create({
    data: {
      organizationId: conversation.organizationId,
      contactId: conversation.contact.id,
      title: result.a_que_se_dedica || conversation.contact.fullName || "Lead calificado por el bot",
      needSummary,
      needStatus: "CONFIRMED",
      authorityLevel: result.rol_contacto || conversation.contact.jobTitle || null,
      aiMemory: result.memoria,
      aiMemoryUpdatedAt: new Date(),
      assignedToId: null,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Si el cliente eligió una franja este turno, crea la Meeting (sin link de
 * Meet todavía — eso lo manda el vendedor a mano, igual que hoy) y avisa
 * al equipo para que confirme el horario real.
 */
async function maybeScheduleMeeting(
  conversation: ConversationForBot,
  result: QualificationResult,
  slots: MeetingSlot[],
  opportunityId: string | null,
): Promise<void> {
  if (!result.reunion_elegida) return;

  const index = { A: 0, B: 1, C: 2 }[result.reunion_elegida];
  const slot = slots[index];
  if (!slot) return;

  await prisma.meeting.create({
    data: {
      organizationId: conversation.organizationId,
      opportunityId,
      scheduledAt: slot.date,
      status: "SCHEDULED",
      notes: "Agendada por el bot de calificación — confirmar horario y mandar el link de Meet al cliente.",
    },
  });

  await notifyNewMessage({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    assignedToId: conversation.assignedToId,
    customerLabel: conversation.customerName || conversation.customerPhone,
    preview: `📅 El bot agendó una reunión para ${slot.label} — confirmá y mandá el link de Meet`,
  }).catch((error) => console.error("[bot] Error notificando reunión agendada:", error));
}

async function sendAndSave(conversation: ConversationForBot, text: string): Promise<void> {
  const { messageId } = await sendTextMessage({
    phoneNumberId: conversation.phoneNumberId,
    accessToken: decrypt(conversation.accessToken),
    to: conversation.customerPhone,
    body: text,
  });

  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: conversation.id, role: "BOT", content: text, externalId: messageId },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);
}

async function escalate(conversation: ConversationForBot, motivo: string): Promise<void> {
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { botPaused: true },
    }),
    prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: "SYSTEM",
        content: `Bot escaló a un humano: ${motivo || "sin motivo indicado"}`,
      },
    }),
  ]);

  await notifyNewMessage({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    assignedToId: conversation.assignedToId,
    customerLabel: conversation.customerName || conversation.customerPhone,
    preview: "🤖 El bot escaló esta conversación a un humano",
  }).catch((error) => console.error("[bot] Error notificando escalamiento:", error));
}

/**
 * Corre un turno del bot de calificación para una conversación: genera la
 * siguiente respuesta (o decide escalar), la manda por WhatsApp, actualiza
 * la memoria, y crea la Opportunity en Seguimiento si el lead ya calificó.
 */
export async function runQualificationTurn(conversationId: string): Promise<void> {
  const conversation = await loadConversation(conversationId);
  // Puede no existir más, o un vendedor pudo haber tomado la conversación
  // (o desactivado el bot, o cambiado el teléfono de prueba) entre que se
  // encoló el job y que corrió.
  const botActiveForThisPhone =
    conversation?.aiQualificationEnabled &&
    (!conversation.aiTestPhone || conversation.aiTestPhone === conversation.customerPhone);
  if (!conversation || conversation.botPaused || !botActiveForThisPhone) return;

  const botMessageCount = await prisma.message.count({
    where: { conversationId, role: "BOT" },
  });
  if (botMessageCount >= MAX_BOT_MESSAGES) {
    await escalate(conversation, "Se alcanzó el máximo de mensajes del bot sin calificar al lead.");
    return;
  }

  const slots = getMeetingSlots();
  const input = await buildInput(conversation, slots);

  const result = await runStructured({
    organizationId: conversation.organizationId,
    entityType: "Conversation",
    entityId: conversationId,
    analysisType: "bot_calificacion",
    promptVersion: PROMPT_VERSION,
    model: MODELS.fast(),
    system: SYSTEM,
    input,
    schemaName: "turno_calificacion",
    schema: jsonSchema,
    parse: (raw) => resultSchema.parse(raw),
  });

  if (result.debe_escalar) {
    if (result.respuesta) await sendAndSave(conversation, result.respuesta);
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { botMemory: result.memoria },
    });
    await escalate(conversation, result.motivo_escalar);
    return;
  }

  if (result.respuesta) await sendAndSave(conversation, result.respuesta);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { botMemory: result.memoria },
  });

  if (result.listo_para_agendar || result.reunion_elegida) {
    const opportunityId = await ensureOpportunity(conversation, result);
    await maybeScheduleMeeting(conversation, result, slots, opportunityId);
  }
}
