import { runStructured, MODELS } from "@/server/services/ai/client";
import {
  KNOWLEDGE_CATEGORIES,
  MAX_CHANGES,
  aiProposalSchema,
  type AiProposal,
  type ItemSnapshot,
} from "@/lib/knowledge-editor";

export const KNOWLEDGE_EDITOR_VERSION = "v1";

const SYSTEM = [
  "Sos el editor de la base de conocimiento de una empresa. La base es lo que los asistentes de IA de la empresa",
  "(bot de calificación y asesor comercial) usan como verdad oficial. Una persona te pide cambios en lenguaje natural",
  "y vos proponés ediciones concretas sobre las entradas existentes. NADA se aplica solo: una persona revisa y aprueba.",
  "",
  "REGLAS:",
  "- Respondé en español, claro y breve, en `message`: qué entendiste y qué vas a cambiar y por qué.",
  "- En `message` y `reason` mencioná las entradas por su TÍTULO, nunca por su id (el id es solo para el campo itemId).",
  "- Identificá la entrada correcta por su id. Si el pedido es ambiguo (no está claro cuál entrada o qué cambio),",
  "  NO adivines: devolvé `changes` vacío y una pregunta puntual en `needsClarification`.",
  "- Cambiá SOLO lo que se pidió. Conservá el resto del texto tal cual (mismas palabras, orden y formato).",
  "- Para `update`, devolvé el contenido COMPLETO nuevo de la entrada (no un parche). Si no cambia el título, devolvé null.",
  "- No inventes datos de la empresa (precios, plazos, políticas, nombres). Si para cumplir el pedido hace falta un dato",
  "  que la persona no dio ni está en la base, pedilo en `needsClarification` en vez de inventarlo.",
  "- Para quitar algo de una entrada, edítala (update). Para dejar de usar una entrada completa, `deactivate`: nunca se borra.",
  "- Usá `create` solo si la información no encaja en ninguna entrada existente; elegí la categoría más adecuada.",
  `- Máximo ${MAX_CHANGES} cambios por pedido. Si el pedido es una pregunta o una conversación sin cambio, devolvé \`changes\` vacío.`,
  "- `reason`: una frase que explique el cambio, para mostrarla junto a la diferencia.",
  "- Las categorías son: SERVICE servicios, PRICING precios, SCOPE alcances, EXCLUSION exclusiones, FAQ preguntas frecuentes,",
  "  POLICY políticas, CASE_STUDY casos, QUALIFICATION guía de calificación de leads, TONE tono de comunicación.",
].join("\n");

const nullableString = { type: ["string", "null"] } as const;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "needsClarification", "changes"],
  properties: {
    message: { type: "string" },
    needsClarification: nullableString,
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "itemId", "category", "title", "content", "reason"],
        properties: {
          action: { type: "string", enum: ["update", "create", "deactivate", "activate"] },
          itemId: { ...nullableString, description: "Id de la entrada existente; null solo en create." },
          category: { type: ["string", "null"], enum: [...KNOWLEDGE_CATEGORIES, null] },
          title: nullableString,
          content: { ...nullableString, description: "Contenido completo nuevo (update/create); null en deactivate/activate." },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export async function proposeKnowledgeChanges(options: {
  organizationId: string;
  userId: string;
  instruction: string;
  history: ChatTurn[];
  items: ItemSnapshot[];
}): Promise<AiProposal> {
  const base = JSON.stringify(
    options.items.map((i) => ({
      id: i.id,
      category: i.category,
      title: i.title,
      active: i.active,
      content: i.content,
    })),
  );

  const history = options.history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Persona" : "Editor"}: ${t.text.slice(0, 1500)}`)
    .join("\n");

  // Lo estable (la base) primero y lo que cambia en cada turno al final, para el caché de prompts de OpenAI.
  const input = [
    "BASE DE CONOCIMIENTO ACTUAL (JSON)",
    base,
    "",
    history ? `CONVERSACIÓN PREVIA\n${history}\n` : "",
    "PEDIDO ACTUAL DE LA PERSONA",
    options.instruction,
  ].join("\n");

  return runStructured<AiProposal>({
    organizationId: options.organizationId,
    entityType: "KnowledgeBase",
    entityId: options.userId,
    analysisType: "knowledge_editor",
    userId: options.userId,
    promptVersion: KNOWLEDGE_EDITOR_VERSION,
    model: MODELS.analysis(),
    system: SYSTEM,
    input,
    schemaName: "editor_conocimiento",
    schema: JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (raw) => aiProposalSchema.parse(raw),
  });
}
