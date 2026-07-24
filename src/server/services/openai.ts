import OpenAI from "openai";

const globalForOpenAI = globalThis as unknown as { openaiClient: OpenAI | undefined };

// Instanciación perezosa: evita fallar al importar este módulo (ej. para
// usar solo `buildSystemPrompt`, como hacen las pruebas) cuando todavía no
// hay OPENAI_API_KEY configurada.
function getClient(): OpenAI {
  if (!globalForOpenAI.openaiClient) {
    globalForOpenAI.openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return globalForOpenAI.openaiClient;
}

const FALLBACK_REPLY =
  "Disculpa, tuve un problema para responder. ¿Podrías repetir tu mensaje?";

interface CatalogItemForPrompt {
  name: string;
  description?: string | null;
  price?: { toString(): string } | null;
}

interface BotConfigForPrompt {
  companyName?: string | null;
  personality?: string | null;
  instructions?: string | null;
}

export function buildSystemPrompt(
  config: BotConfigForPrompt,
  catalog: CatalogItemForPrompt[],
): string {
  const parts: string[] = [
    `Eres el asistente de ventas de WhatsApp de "${config.companyName ?? "la empresa"}".`,
    "Tu objetivo es ayudar al cliente y guiarlo hacia una compra, de forma natural y sin ser insistente.",
  ];

  if (config.personality) {
    parts.push(`Carácter y tono: ${config.personality}`);
  }

  if (config.instructions) {
    parts.push(`Instrucciones específicas del negocio: ${config.instructions}`);
  }

  if (catalog.length > 0) {
    const catalogText = catalog
      .map((item) => {
        const price = item.price ? ` — $${item.price}` : "";
        const description = item.description ? `: ${item.description}` : "";
        return `- ${item.name}${price}${description}`;
      })
      .join("\n");
    parts.push(`Catálogo disponible:\n${catalogText}`);
  }

  parts.push(
    "Responde siempre en el idioma del cliente, en mensajes cortos apropiados para WhatsApp.",
  );

  return parts.join("\n\n");
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export async function generateReply(params: {
  model: string;
  systemPrompt: string;
  history: ChatMessage[];
  userMessage: string;
}): Promise<string> {
  const { model, systemPrompt, history, userMessage } = params;

  const completion = await getClient().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userMessage },
    ],
  });

  return completion.choices[0]?.message?.content?.trim() || FALLBACK_REPLY;
}
