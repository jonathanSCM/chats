import { z } from "zod";
import { prisma } from "@/server/db/client";
import { STAGE_LABEL, type Stage } from "@/lib/pipeline";
import { audit } from "@/server/services/audit";
import { MODELS, runStructured } from "./client";

export const PROMPT_VERSION = "seguimiento-v2";

const desgloseSchema = z.object({
  empresa_en_marcha: z.number().min(0).max(20),
  dolor_concreto: z.number().min(0).max(20),
  impacto: z.number().min(0).max(15),
  decisor: z.number().min(0).max(15),
  capacidad_inversion: z.number().min(0).max(15),
  encaje_proshop: z.number().min(0).max(10),
  urgencia: z.number().min(0).max(5),
});

/** Lo que el modelo debe devolver: las columnas de IA de la planilla, la calificación del lead y la memoria. */
const resultSchema = z.object({
  prioridad: z.enum(["ALTA", "MEDIA", "BAJA"]),
  proximo_contacto: z.string(), // ISO yyyy-mm-dd, o "" si no corresponde
  probabilidad_cierre: z.number().min(0).max(100),
  recomendacion: z.string().min(1),
  mensaje_sugerido: z.string().min(1),
  razon: z.string().min(1),
  memoria: z.string().min(1),
  // Calidad del lead (0-100): indicador DISTINTO de probabilidad_cierre —
  // ver reglas en el SYSTEM prompt.
  calidad_lead: z.number().min(0).max(100),
  desglose: desgloseSchema,
  cobertura_informacion: z.number().min(0).max(100),
  dolor_principal: z.string().min(1),
  informacion_faltante: z.array(z.string()).max(3),
  siguiente_pregunta: z.string().min(1),
  alertas: z.string().min(1),
});

export type FollowUpResult = z.infer<typeof resultSchema>;

const desgloseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "empresa_en_marcha",
    "dolor_concreto",
    "impacto",
    "decisor",
    "capacidad_inversion",
    "encaje_proshop",
    "urgencia",
  ],
  properties: {
    empresa_en_marcha: { type: "number", description: "0 a 20." },
    dolor_concreto: { type: "number", description: "0 a 20." },
    impacto: { type: "number", description: "0 a 15." },
    decisor: { type: "number", description: "0 a 15." },
    capacidad_inversion: { type: "number", description: "0 a 15." },
    encaje_proshop: { type: "number", description: "0 a 10." },
    urgencia: { type: "number", description: "0 a 5." },
  },
} as const;

const jsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "prioridad",
    "proximo_contacto",
    "probabilidad_cierre",
    "recomendacion",
    "mensaje_sugerido",
    "razon",
    "memoria",
    "calidad_lead",
    "desglose",
    "cobertura_informacion",
    "dolor_principal",
    "informacion_faltante",
    "siguiente_pregunta",
    "alertas",
  ],
  properties: {
    prioridad: {
      type: "string",
      enum: ["ALTA", "MEDIA", "BAJA"],
      description: "Qué tan urgente es atender a este cliente.",
    },
    proximo_contacto: {
      type: "string",
      description:
        "Fecha en formato yyyy-mm-dd para el próximo contacto. Cadena vacía si no corresponde volver a contactar.",
    },
    probabilidad_cierre: {
      type: "number",
      description: "Probabilidad de cerrar la venta, de 0 a 100.",
    },
    recomendacion: {
      type: "string",
      description:
        "Qué debe hacer el vendedor para avanzar al cierre. Concreto y accionable, máximo 3 frases.",
    },
    mensaje_sugerido: {
      type: "string",
      description:
        "Borrador de mensaje de WhatsApp para enviarle al cliente. Breve, profesional, sin presionar.",
    },
    razon: {
      type: "string",
      description: "Por qué se asignó esa prioridad y probabilidad. Una o dos frases.",
    },
    memoria: {
      type: "string",
      description:
        "Resumen actualizado de todo lo importante que se sabe de este cliente hasta ahora " +
        "(intereses, objeciones, presupuesto mencionado, promesas hechas, próximos pasos acordados). " +
        "Parte de la MEMORIA ANTERIOR si existe y agrégale o corrige con lo nuevo de esta conversación " +
        "— no la repitas igual si no cambió nada relevante. Texto libre, breve (máximo ~6 líneas), sin " +
        "inventar datos que no estén en la conversación o notas.",
    },
    calidad_lead: {
      type: "number",
      description:
        "Calidad del lead, 0 a 100 — qué tan buena oportunidad comercial es (encaje, tamaño, dolor real). " +
        "NO es lo mismo que probabilidad_cierre: un lead puede tener calidad alta pero probabilidad baja " +
        "si todavía falta reunión, presupuesto o decisión. Es la suma exacta de los 7 campos de 'desglose'.",
    },
    desglose: desgloseJsonSchema,
    cobertura_informacion: {
      type: "number",
      description:
        "Qué porcentaje (0-100) de la información necesaria para calificar bien a este lead ya se conoce. " +
        "Un lead con poca información no debe parecer artificialmente malo — usa este campo para mostrarlo.",
    },
    dolor_principal: {
      type: "string",
      description:
        "El problema principal del cliente, desde el punto de vista del negocio, en una frase concreta " +
        "(no 'necesita IA', sino algo como 'dos personas gestionan manualmente los leads de WhatsApp y " +
        "pierden ventas por no alcanzar a atenderlos todos').",
    },
    informacion_faltante: {
      type: "array",
      items: { type: "string" },
      description: "Hasta 3 datos concretos que más cambiarían la decisión comercial si se conocieran.",
    },
    siguiente_pregunta: {
      type: "string",
      description: "Una sola pregunta, sencilla y natural, que el vendedor debería hacer a continuación.",
    },
    alertas: {
      type: "string",
      description:
        "Contradicciones, datos poco confiables, o cosas que el vendedor debería revisar antes de confiar " +
        "en este análisis. Si no hay ninguna, responde exactamente 'Sin alertas relevantes.'.",
    },
  },
} as const;

const SYSTEM = `Eres el asesor comercial interno de la empresa. Ayudas al vendedor a decidir el siguiente paso con cada cliente.

Reglas:
- No inventes información. Si un dato no está, trabaja con lo que hay y dilo en la razón.
- No prometas resultados, plazos ni descuentos que no estén en la información de la empresa.
- Prioriza preguntas de negocio antes que detalles técnicos.
- El mensaje sugerido es un borrador para que el vendedor lo revise: breve, claro, en español neutro y sin presionar al cliente.
- Si el cliente no responde hace tiempo, es preferible un último mensaje corto y pausar, en vez de insistir.
- La probabilidad debe ser realista: si no hay respuesta ni presupuesto confirmado, es baja.
- La "memoria" es un resumen que se reutiliza en cada análisis futuro de este mismo cliente: mantenla
  corta y factual, actualizándola en vez de repetirla — es la forma en que recuerdas la conversación
  completa aunque solo veas los mensajes más recientes.
- Devuelve exclusivamente el JSON del esquema pedido.

Sobre "calidad_lead" (0-100, desglose de 7 criterios) y "probabilidad_cierre" (0-100%):
- Son DOS indicadores distintos, nunca los confundas ni conviertas uno en el otro automáticamente.
  calidad_lead mide qué tan buena oportunidad comercial es (encaje, tamaño, dolor real). probabilidad_cierre
  mide qué tan probable es que compre AHORA. Un lead puede tener calidad_lead 90 y probabilidad_cierre 40
  a la vez: buen encaje, pero todavía falta reunión, presupuesto o decisión.
- Usa exactamente los criterios y puntajes de la "GUÍA DE CALIFICACIÓN" que viene en la información de
  abajo (categoría de la Base de Conocimiento). Si no hay ninguna guía cargada, usa como referencia general:
  empresa en marcha (0-20), dolor concreto (0-20), impacto del problema (0-15), decisor (0-15), capacidad
  de inversión (0-15), encaje con la empresa (0-10), urgencia (0-5).
- Diferencia siempre CONFIRMADO (lo dijo el cliente) de INFERIDO (lo dedujiste) y DESCONOCIDO (no se sabe).
  Nunca trates una afirmación del propio chatbot/vendedor como si el cliente la hubiera confirmado.
  DESCONOCIDO no es lo mismo que NEGATIVO: si nunca se habló de presupuesto, es "desconocido", no "no tiene".
- Sé conservador con probabilidad_cierre: entusiasmo, respuestas rápidas o aceptar una reunión no bastan
  para una probabilidad alta.
- Las TRANSCRIPCIONES/RESÚMENES DE REUNIONES son la fuente más confiable de todas: son declaraciones
  directas del lead, cargadas por el vendedor después de una llamada real. Dales más peso que a mensajes
  de WhatsApp cortos o notas genéricas del equipo al justificar "evidencia" en la razón y en el desglose.`;

interface OpportunityContext {
  id: string;
  organizationId: string;
  title: string;
  stage: Stage;
  serviceInterest: string | null;
  needSummary: string | null;
  lastUpdate: string | null;
  estimatedValue: unknown;
  nextContactAt: Date | null;
  createdAt: Date;
  aiMemory: string | null;
  contact: { fullName: string | null; phone: string; city: string | null };
}

// Tope duro independiente de lo que configure el admin: por más que suba el
// número, no tiene sentido mandar miles de mensajes en cada análisis — el
// costo se dispara y el modelo igual no lee bien contextos gigantes.
const MAX_MESSAGE_LIMIT = 100;
const MIN_MESSAGE_LIMIT = 5;
const DEFAULT_MESSAGE_LIMIT = 25;

function clampMessageLimit(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_MESSAGE_LIMIT;
  return Math.min(MAX_MESSAGE_LIMIT, Math.max(MIN_MESSAGE_LIMIT, Math.round(value)));
}

/**
 * Arma el contexto que se le manda al modelo. No se envía toda la base:
 * solo la ficha del cliente, su historial reciente (ajustable por el admin
 * de la organización) y el conocimiento autorizado de la empresa (manual §25).
 */
async function buildInput(opportunity: OpportunityContext): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: opportunity.organizationId },
    select: { aiMessageLimit: true },
  });
  const messageLimit = clampMessageLimit(org?.aiMessageLimit);

  const [knowledge, recentMessages, notes, meetings] = await Promise.all([
    prisma.knowledgeItem.findMany({
      where: { organizationId: opportunity.organizationId, active: true },
      select: { category: true, title: true, content: true },
      orderBy: { category: "asc" },
      take: 40,
    }),
    prisma.message.findMany({
      where: { conversation: { contact: { phone: opportunity.contact.phone } } },
      select: { role: true, content: true, createdAt: true, mediaType: true },
      orderBy: { createdAt: "desc" },
      take: messageLimit,
    }),
    prisma.conversationNote.findMany({
      where: { conversation: { contact: { phone: opportunity.contact.phone } } },
      select: { body: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.meeting.findMany({
      where: { opportunityId: opportunity.id, notes: { not: null } },
      select: { scheduledAt: true, status: true, notes: true },
      orderBy: { scheduledAt: "desc" },
      take: 5,
    }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  // La guía de calificación (categoría QUALIFICATION) se separa del resto:
  // es la regla obligatoria para calcular "calidad_lead", no solo contexto
  // general de la empresa. Se lee directamente de la Base de Conocimiento —
  // así se puede ajustar sin tocar código.
  const qualificationItems = knowledge.filter((k) => k.category === "QUALIFICATION");
  const generalKnowledge = knowledge.filter((k) => k.category !== "QUALIFICATION");

  const qualificationGuideText = qualificationItems.length
    ? qualificationItems.map((k) => `${k.title}\n${k.content}`).join("\n\n---\n\n")
    : null;

  const knowledgeText = generalKnowledge.length
    ? generalKnowledge.map((k) => `[${k.category}] ${k.title}: ${k.content}`).join("\n")
    : "(Sin información cargada. No inventes servicios ni precios.)";

  const conversationText = recentMessages.length
    ? recentMessages
        .slice()
        .reverse()
        .map((m) => {
          const who = m.role === "CUSTOMER" ? "Cliente" : "Vendedor";
          const body = m.content || (m.mediaType ? `[${m.mediaType.toLowerCase()}]` : "");
          return `${who} (${m.createdAt.toISOString().slice(0, 10)}): ${body}`;
        })
        .join("\n")
    : "(Sin mensajes registrados.)";

  const notesText = notes.length
    ? notes.map((n) => `- ${n.createdAt.toISOString().slice(0, 10)}: ${n.body}`).join("\n")
    : "(Sin notas.)";

  // Fuente de mayor confianza: declaraciones directas del lead en una
  // reunión, cargadas a mano por el vendedor (transcripción o resumen).
  const meetingsText = meetings.length
    ? meetings
        .map(
          (m) =>
            `--- Reunión del ${m.scheduledAt.toISOString().slice(0, 10)} (${m.status}) ---\n${m.notes}`,
        )
        .join("\n\n")
    : null;

  // El orden importa para el prompt caching automático de OpenAI: cachea el
  // PREFIJO de tokens desde el principio, así que lo que es igual para toda
  // la organización (fecha del día, conocimiento, guía) va primero, y lo que
  // cambia en cada llamada (cliente, conversación) va al final. Antes el
  // conocimiento iba al final, después de la conversación variable — eso
  // invalidaba el cache en cada llamada en vez de reusarlo entre análisis de
  // la misma organización.
  return `FECHA DE HOY: ${today}

INFORMACIÓN AUTORIZADA DE LA EMPRESA
${knowledgeText}

GUÍA DE CALIFICACIÓN (obligatoria — usa exactamente estos criterios y puntajes para "calidad_lead" y "desglose")
${qualificationGuideText ?? "(No hay ninguna guía cargada en la Base de Conocimiento, categoría 'Guía de calificación'. Usa la referencia general del SYSTEM.)"}

CLIENTE
Nombre: ${opportunity.contact.fullName ?? "(desconocido)"}
Teléfono: ${opportunity.contact.phone}
Ciudad: ${opportunity.contact.city ?? "(no registrada)"}

OPORTUNIDAD
Registrada el: ${opportunity.createdAt.toISOString().slice(0, 10)}
Servicio de interés: ${opportunity.serviceInterest ?? "(sin definir)"}
Estado actual: ${STAGE_LABEL[opportunity.stage]}
Necesidad / contexto: ${opportunity.needSummary ?? opportunity.title}
Valor estimado: ${opportunity.estimatedValue ? String(opportunity.estimatedValue) : "(sin cotizar)"}
Última actualización del vendedor: ${opportunity.lastUpdate ?? "(sin registrar)"}
Próximo contacto agendado: ${opportunity.nextContactAt?.toISOString().slice(0, 10) ?? "(ninguno)"}

MEMORIA ANTERIOR DEL ASESOR IA (resumen acumulado de análisis previos — actualízala, no la ignores)
${opportunity.aiMemory ?? "(Todavía no hay memoria — es el primer análisis de este cliente.)"}

TRANSCRIPCIONES/RESÚMENES DE REUNIONES (fuente de mayor confianza — declaraciones directas del lead)
${meetingsText ?? "(No hay reuniones con transcripción cargada.)"}

NOTAS INTERNAS DEL EQUIPO
${notesText}

CONVERSACIÓN DE WHATSAPP, ventana de los últimos ${messageLimit} mensajes (más reciente al final)
${conversationText}`;
}

/**
 * Analiza una oportunidad y guarda la propuesta del asesor en las columnas
 * de IA. No toca lo que escribió la persona (estado, necesidad, última
 * actualización): la IA propone, el vendedor decide (manual §28).
 */
export async function analyzeFollowUp(opportunityId: string): Promise<FollowUpResult> {
  const opportunity = await prisma.opportunity.findUnique({
    where: { id: opportunityId },
    include: { contact: { select: { fullName: true, phone: true, city: true } } },
  });
  if (!opportunity) throw new Error("Oportunidad no encontrada");

  const input = await buildInput(opportunity as OpportunityContext);

  const result = await runStructured({
    organizationId: opportunity.organizationId,
    entityType: "Opportunity",
    entityId: opportunityId,
    analysisType: "seguimiento",
    promptVersion: PROMPT_VERSION,
    model: MODELS.analysis(),
    system: SYSTEM,
    input,
    schemaName: "analisis_seguimiento",
    schema: jsonSchema,
    parse: (raw) => resultSchema.parse(raw),
  });

  const nextContactAt = parseDate(result.proximo_contacto);

  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      priority: result.prioridad,
      probability: Math.round(result.probabilidad_cierre),
      aiRecommendation: result.recomendacion,
      aiSuggestedMessage: result.mensaje_sugerido,
      aiReviewedAt: new Date(),
      leadScore: Math.round(result.calidad_lead),
      leadScoreBreakdown: result.desglose,
      leadScoreCoverage: Math.round(result.cobertura_informacion),
      leadScoreUpdatedAt: new Date(),
      aiPainPoint: result.dolor_principal,
      aiMissingInfo: result.informacion_faltante.join("\n"),
      aiNextQuestion: result.siguiente_pregunta,
      aiAlerts: result.alertas,
      aiMemory: result.memoria,
      aiMemoryUpdatedAt: new Date(),
      // Solo se propone fecha si no había una puesta por una persona.
      ...(nextContactAt && !opportunity.nextContactAt ? { nextContactAt } : {}),
    },
  });

  await audit({
    entityType: "Opportunity",
    entityId: opportunityId,
    action: "ai_analysis",
    actor: "AI",
    organizationId: opportunity.organizationId,
    after: {
      prioridad: result.prioridad,
      probabilidad: result.probabilidad_cierre,
      razon: result.razon,
    },
  });

  return result;
}

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
