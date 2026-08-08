import { z } from "zod";
import { prisma } from "@/server/db/client";
import { STAGE_LABEL, type Stage } from "@/lib/pipeline";
import { audit } from "@/server/services/audit";
import { MODELS, runStructured } from "./client";

export const PROMPT_VERSION = "seguimiento-v1";

/** Lo que el modelo debe devolver: las cinco columnas de IA de la planilla, más la memoria. */
const resultSchema = z.object({
  prioridad: z.enum(["ALTA", "MEDIA", "BAJA"]),
  proximo_contacto: z.string(), // ISO yyyy-mm-dd, o "" si no corresponde
  probabilidad_cierre: z.number().min(0).max(100),
  recomendacion: z.string().min(1),
  mensaje_sugerido: z.string().min(1),
  razon: z.string().min(1),
  memoria: z.string().min(1),
});

export type FollowUpResult = z.infer<typeof resultSchema>;

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
- Devuelve exclusivamente el JSON del esquema pedido.`;

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

  const [knowledge, recentMessages, notes] = await Promise.all([
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
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const knowledgeText = knowledge.length
    ? knowledge.map((k) => `[${k.category}] ${k.title}: ${k.content}`).join("\n")
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

  return `FECHA DE HOY: ${today}

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

NOTAS INTERNAS DEL EQUIPO
${notesText}

CONVERSACIÓN DE WHATSAPP, ventana de los últimos ${messageLimit} mensajes (más reciente al final)
${conversationText}

INFORMACIÓN AUTORIZADA DE LA EMPRESA
${knowledgeText}`;
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
