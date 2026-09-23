import { z } from "zod";
import { prisma } from "@/server/db/client";
import { decrypt } from "@/lib/crypto";
import { sendTextMessage, sendInteractiveListMessage, type InteractiveListRow } from "@/server/services/whatsapp";
import { notifyNewMessage } from "@/server/services/push";
import { OPEN_STAGES } from "@/lib/pipeline";
import { getAvailableDays, getAvailableSlots, hasSchedulingConflict, formatSlotLabel } from "@/server/services/availability";
import { MODELS, runStructured } from "./client";

// v2: se saca "reunion_elegida" del esquema -- el horario ya no se elige
// interpretando texto libre, se ofrece por lista de WhatsApp y se resuelve
// directo por el id de la opción (ver sendDayList/sendHourList/confirmMeetingSlot).
export const PROMPT_VERSION = "bot-calificacion-v2";

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
        "true solo cuando ya hay empresa real + problema real + posible mejora con tecnología, y el " +
        "cliente ya dijo que sí quiere agendar la reunión de diagnóstico. El sistema (no vos) manda " +
        "aparte una lista de WhatsApp con los días y horarios reales para que el cliente elija tocando " +
        "una opción -- no hace falta que menciones fechas ni horarios en tu respuesta.",
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
- Usa un emoji simple y de uso común (👋 👍 🙂 ✅) en el saludo inicial y de vez en cuando en el resto de
  la charla para sumar calidez — nunca más de uno por mensaje, y nunca en mensajes serios (escalamiento,
  quejas). No los fuerces en cada mensaje, pero tampoco los evites: una conversación sin ninguno en toda
  la charla sí sería un error.
- Una sola pregunta o idea por mensaje. Nunca combines varias preguntas en un "respuesta".
- Usa lo que el cliente ya explicó, aunque lo haya contado de pasada al responder otra pregunta. Si un
  dato ya se sabe (por la conversación o por la MEMORIA ANTERIOR) no lo vuelvas a preguntar ni pidas más
  detalle sobre algo que ya quedó claro — avanza directo a lo que todavía falta.
- Si en la conversación aparecen mensajes de "Vendedor humano" (alguien del equipo tomó el chat un rato
  y después te reactivaron), leelos igual que los del cliente: no repitas preguntas que ya respondió ahí,
  no contradigas nada que esa persona ya le dijo al cliente, y seguí la charla de forma natural desde
  donde quedó.
- No inventes información que el cliente no dio.
- No ofrezcas ni menciones soluciones concretas de ProShop todavía — eso se hace en la reunión de diagnóstico.
- No hagas el diagnóstico completo por WhatsApp (presupuesto, volumen exacto, decisor, urgencia, etc.):
  esas preguntas son para la reunión, no para acá.
- Si el cliente hace una pregunta directa, respóndela en una frase y vuelve de forma natural al filtro.
- Si el cliente pide hablar con una persona, se queja, o hace algo que esta guía no cubre, pon
  debe_escalar en true y deja de insistir con preguntas.
- Primero invita a la reunión de diagnóstico en general (sin mencionar horarios) y espera a que el
  cliente acepte. Cuando el cliente ya dijo que sí quiere agendar, poné "listo_para_agendar" en true y
  tu "respuesta" es solo una frase corta de transición (ej. "Perfecto 😊 Te paso los horarios
  disponibles 👇") -- el sistema manda aparte, automáticamente, la lista real de días y horarios para
  que el cliente elija tocando una opción. Nunca inventes ni menciones un día u horario específico vos
  mismo, ni le pidas al cliente que escriba una hora -- de eso se encarga la lista que manda el sistema.
- Si el cliente ya recibió la lista de horarios y todavía no tocó ninguna opción (sigue escribiendo
  texto), seguí la charla con naturalidad sin repetir la invitación a cada rato.
- El guion exacto de preguntas, cuándo agendar, cuándo no agendar, y el estilo de conversación están en
  la GUÍA DE CALIFICACIÓN y el TONO de la Base de Conocimiento de abajo — síguelos al pie de la letra.
  Si no hay ninguna guía cargada, usa como referencia general: entender a qué se dedica la empresa, qué
  quiere mejorar, cómo lo hacen hoy, qué problema real les genera, y qué función tiene el contacto —
  siempre de a una pregunta por vez, sin vender antes de tiempo.
- Devuelve exclusivamente el JSON del esquema pedido.`;

interface ConversationForBot {
  id: string;
  organizationId: string;
  timezone: string;
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

export async function loadConversation(conversationId: string): Promise<ConversationForBot | null> {
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
    timezone: conversation.bot.organization.timezone,
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
async function buildInput(conversation: ConversationForBot): Promise<string> {
  const [knowledge, recentMessages] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { organizationId: conversation.organizationId, active: true },
      select: { category: true, title: true, content: true },
      orderBy: { category: "asc" },
      take: 40,
    }),
    prisma.message.findMany({
      // Incluye STAFF: si un vendedor tomó la conversación un rato y
      // después la reactivó, el bot tiene que ver lo que la persona ya
      // contestó — si no, puede repreguntar algo que el cliente ya le
      // aclaró a un humano.
      where: { conversationId: conversation.id, role: { in: ["CUSTOMER", "BOT", "STAFF"] } },
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

  const speakerLabel = { CUSTOMER: "Cliente", BOT: "Bot", STAFF: "Vendedor humano" } as const;
  const conversationText = recentMessages.length
    ? recentMessages
        .slice()
        .reverse()
        .map((m) => `${speakerLabel[m.role as "CUSTOMER" | "BOT" | "STAFF"]}: ${m.content}`)
        .join("\n")
    : "(Sin mensajes previos — es el primer mensaje de esta conversación.)";

  // Mismo criterio de orden que buildInput() en follow-up.ts: lo fijo por
  // organización (fecha, guía, tono) primero para que el cache automático de
  // OpenAI lo reconozca como el mismo prefijo entre turnos y conversaciones
  // distintas; lo que cambia en cada turno (cliente, memoria, conversación)
  // al final.
  return `FECHA DE HOY: ${new Date().toISOString().slice(0, 10)}

GUÍA DE CALIFICACIÓN (obligatoria)
${qualificationText}

TONO DE CONVERSACIÓN (obligatorio)
${toneText}

CLIENTE
Nombre de perfil de WhatsApp: ${conversation.customerName ?? "(desconocido)"}
Teléfono: ${conversation.customerPhone}

MEMORIA ANTERIOR (resumen acumulado de esta conversación — actualízala, no la ignores)
${conversation.botMemory ?? "(Todavía no hay memoria — es el primer turno.)"}

CONVERSACIÓN DE WHATSAPP (más reciente al final)
${conversationText}`;
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

  // Antes esto traía CUALQUIER oportunidad del contacto (sin orderBy, así
  // que Prisma podía devolver cualquiera de varias) y solo evitaba duplicar
  // si esa, la que sea, estaba abierta. Si un contacto tenía más de una
  // oportunidad y la que Prisma devolvía primero resultaba estar cerrada
  // (GANADO/PERDIDO) mientras otra seguía abierta, este chequeo no la veía
  // y creaba un lead duplicado. Ahora se busca directamente una abierta
  // entre TODAS las del contacto.
  const existingOpen = await prisma.opportunity.findFirst({
    where: { contactId: conversation.contact.id, archivedAt: null, stage: { in: OPEN_STAGES } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  if (existingOpen) return existingOpen.id;

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

async function sendListAndSave(
  conversation: ConversationForBot,
  params: { bodyText: string; buttonText: string; sectionTitle: string; rows: InteractiveListRow[] },
  recordedAs: string,
): Promise<void> {
  const { messageId } = await sendInteractiveListMessage({
    phoneNumberId: conversation.phoneNumberId,
    accessToken: decrypt(conversation.accessToken),
    to: conversation.customerPhone,
    ...params,
  });

  await prisma.$transaction([
    prisma.message.create({
      data: { conversationId: conversation.id, role: "BOT", content: recordedAs, externalId: messageId },
    }),
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    }),
  ]);
}

/**
 * Primer paso del agendamiento por lista de WhatsApp: ofrece los días con
 * hueco real (no horarios sueltos, para no repetir el mismo día varias
 * veces -- ver getAvailableDays). Lo dispara runQualificationTurn en
 * cuanto el modelo marca "listo_para_agendar"; el segundo paso (elegir
 * hora) y el tercero (confirmar) llegan por la respuesta del cliente a la
 * lista, no por otro turno del modelo -- ver handleIncomingMessage en
 * conversation.ts, que intercepta los ids "day:"/"slot:" antes de
 * encolar el turno normal del bot.
 */
export async function sendDayList(conversationId: string): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) return;

  const days = await getAvailableDays(conversation.organizationId, 8);
  if (days.length === 0) {
    await sendAndSave(
      conversation,
      "Mmm, por ahora no tengo ningún horario libre para ofrecerte 🙏 Te paso con alguien del equipo para coordinar directamente.",
    );
    await escalate(conversation, "No hay horarios disponibles para ofrecer al lead.");
    return;
  }

  const rows: InteractiveListRow[] = days.map((day) => ({ id: `day:${day.dateKey}`, title: day.label.slice(0, 24) }));
  await sendListAndSave(
    conversation,
    { bodyText: "¿Qué día te queda mejor para la reunión?", buttonText: "Ver días", sectionTitle: "Días disponibles", rows },
    `[Lista de días] ${days.map((d) => d.label).join(" · ")}`,
  );
}

/** Segundo paso: el cliente eligió un día -- ofrece los horarios de ESE día puntual. */
export async function sendHourList(conversationId: string, dateKey: string): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) return;

  const slots = await getAvailableSlots(conversation.organizationId, 8, 30, dateKey);
  if (slots.length === 0) {
    // Puede pasar: alguien más tomó el último hueco de ese día entre que se
    // ofreció la lista de días y que el cliente tocó una opción.
    await sendAndSave(
      conversation,
      "Uy, se me ocuparon justo los horarios de ese día 🙈 ¿Probamos con otro? Decime cuál y te muestro.",
    );
    return;
  }

  const rows: InteractiveListRow[] = slots.map((slot) => ({ id: `slot:${slot.date.toISOString()}`, title: slot.label.slice(0, 24) }));
  await sendListAndSave(
    conversation,
    { bodyText: "Perfecto 👍 Estos son los horarios libres ese día.", buttonText: "Ver horarios", sectionTitle: "Horarios disponibles", rows },
    `[Lista de horarios] ${slots.map((s) => s.label).join(" · ")}`,
  );
}

/**
 * Tercer paso: el cliente eligió un horario puntual -- crea la reunión de
 * verdad. El contacto normalmente ya tiene una Opportunity abierta
 * (ensureOpportunity la crea apenas "listo_para_agendar"), pero si por
 * algún motivo no la tiene (ej. retomó una charla vieja), se crea una acá
 * para no perder la reunión.
 */
export async function confirmMeetingSlot(conversationId: string, isoDate: string): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) return;

  const slotDate = new Date(isoDate);
  if (Number.isNaN(slotDate.getTime())) return;

  let opportunityId: string | null = null;
  if (conversation.contact) {
    const existingOpen = await prisma.opportunity.findFirst({
      where: { contactId: conversation.contact.id, archivedAt: null, stage: { in: OPEN_STAGES } },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    opportunityId = existingOpen
      ? existingOpen.id
      : (
          await prisma.opportunity.create({
            data: {
              organizationId: conversation.organizationId,
              contactId: conversation.contact.id,
              title: conversation.contact.fullName || "Lead calificado por el bot",
              needSummary: conversation.botMemory ?? "",
              needStatus: "CONFIRMED",
              aiMemory: conversation.botMemory,
              aiMemoryUpdatedAt: conversation.botMemory ? new Date() : null,
              assignedToId: null,
            },
            select: { id: true },
          })
        ).id;
  }

  // El modelo puede repetir el turno, o el cliente puede volver a tocar la
  // lista vieja -- sin este chequeo, cada vez así crearía otra Meeting
  // duplicada para la misma oportunidad.
  if (opportunityId) {
    const alreadyScheduled = await prisma.meeting.findFirst({
      where: { opportunityId, status: { not: "CANCELED" } },
      select: { id: true },
    });
    if (alreadyScheduled) {
      await sendAndSave(conversation, "Ya tenés una reunión agendada 👍 Cualquier cambio, escribime por acá y lo vemos.");
      return;
    }
  }

  // Entre que se ofreció esta franja (sendHourList, turnos atrás) y que el
  // cliente la eligió ahora, otro lead pudo haber tomado el mismo horario
  // -- se re-chequea justo acá, no solo al armar la lista. No se bloquea
  // la creación (no hay forma de "desdecir" la lista que ya se mandó): se
  // crea igual, pero marcada bien visible para que un vendedor la resuelva
  // a mano en vez de quedar un choque silencioso en el calendario.
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: conversation.organizationId },
    select: { bookingDurationMinutes: true },
  });
  const conflict = await hasSchedulingConflict(conversation.organizationId, slotDate, org.bookingDurationMinutes);
  const label = formatSlotLabel(slotDate, conversation.timezone);

  // El bot ya no crea el link de Meet -- decisión explícita: la creación de
  // Calendar/Meet quedó reservada para cuando un vendedor la arma a mano
  // (ver createMeetingAction en crm.ts). Acá solo se deja agendada la fecha
  // y el nombre, para que la reunión ya aparezca en el CRM y el vendedor
  // solo tenga que completar el link.
  const title = `Reunión de diagnóstico — ${conversation.contact?.fullName || conversation.contact?.phone || "Lead"}`;

  await prisma.meeting.create({
    data: {
      organizationId: conversation.organizationId,
      opportunityId,
      title,
      scheduledAt: slotDate,
      durationMinutes: org.bookingDurationMinutes,
      meetingUrl: null,
      status: "SCHEDULED",
      notes: conflict
        ? "⚠️ Posible choque de horario: otra reunión ya ocupaba esta franja cuando se confirmó. Revisar y reagendar si hace falta. Agendada automáticamente por el bot de calificación."
        : "Agendada automáticamente por el bot de calificación. Falta agregar el link de la reunión.",
    },
  });

  await sendAndSave(conversation, `Listo, quedó agendada para el ${label} 🙌 En breve te paso el link de la reunión.`);

  await notifyNewMessage({
    conversationId: conversation.id,
    organizationId: conversation.organizationId,
    assignedToId: conversation.assignedToId,
    customerLabel: conversation.customerName || conversation.customerPhone,
    preview: conflict
      ? `⚠️ El bot agendó una reunión para ${label}, pero choca con otra — revisar`
      : `📅 El bot agendó una reunión para ${label} — falta el link de Meet`,
  }).catch((error) => console.error("[bot] Error notificando reunión agendada:", error));
}

/**
 * El job de bot_reply agotó sus reintentos (fallo real de la IA, no falta de
 * presupuesto — eso se maneja aparte). Sin esto el lead se queda sin
 * respuesta y nadie se entera salvo que alguien note manualmente que nadie
 * contestó: se pausa el bot y se deja un aviso SYSTEM, mismo mecanismo que
 * un escalamiento normal, para que se vea el badge "Necesita atención".
 */
export async function markBotReplyFailed(rawPayload: unknown): Promise<void> {
  const parsed = z.object({ conversationId: z.string() }).safeParse(rawPayload);
  if (!parsed.success) return;

  const conversation = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: {
      id: true,
      botPaused: true,
      assignedToId: true,
      customerName: true,
      customerPhone: true,
      bot: { select: { organizationId: true } },
    },
  });
  if (!conversation || conversation.botPaused) return;

  await escalate(
    {
      id: conversation.id,
      organizationId: conversation.bot.organizationId,
      assignedToId: conversation.assignedToId,
      customerName: conversation.customerName,
      customerPhone: conversation.customerPhone,
    } as ConversationForBot,
    "la IA no pudo responder después de varios intentos",
  );
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

  const input = await buildInput(conversation);

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

  if (result.listo_para_agendar) {
    const opportunityId = await ensureOpportunity(conversation, result);
    // No repetir la lista de días si ya hay una reunión agendada para esta
    // oportunidad -- el cliente puede seguir escribiendo con
    // "listo_para_agendar" en true varios turnos seguidos aunque ya haya
    // confirmado un horario (ver confirmMeetingSlot en conversation.ts).
    const alreadyScheduled =
      opportunityId &&
      (await prisma.meeting.findFirst({
        where: { opportunityId, status: { not: "CANCELED" } },
        select: { id: true },
      }));
    if (!alreadyScheduled) await sendDayList(conversationId);
  }
}
