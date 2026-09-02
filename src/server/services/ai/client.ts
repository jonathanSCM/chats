import OpenAI, { toFile } from "openai";
import { prisma } from "@/server/db/client";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && process.env.AI_ENABLED !== "false";
}

/**
 * Transcribe un audio grabado (ej. la reunión que subió el bot) con Whisper.
 * Endpoint distinto de `runStructured` (que es chat/JSON-schema) — no pasa
 * por el tracking de costo de `AiAnalysis` porque no cobra por tokens sino
 * por minuto de audio (~US$0.006/min); el costo real se ve en la cuenta de
 * OpenAI, no acá.
 */
export async function transcribeAudio(buffer: Buffer, fileName: string, mimeType: string): Promise<string> {
  if (!isAiEnabled()) {
    throw new Error("La IA no está configurada (falta OPENAI_API_KEY)");
  }
  const file = await toFile(buffer, fileName, { type: mimeType });
  const response = await getClient().audio.transcriptions.create({ file, model: "whisper-1" });
  return response.text;
}

/**
 * Modelos configurables por entorno, nunca escritos en el código: los
 * nombres y precios cambian seguido (manual §20).
 */
export const MODELS = {
  fast: () => process.env.OPENAI_MODEL_FAST || "gpt-4.1-mini",
  analysis: () => process.env.OPENAI_MODEL_ANALYSIS || "gpt-4.1-mini",
  executive: () => process.env.OPENAI_MODEL_EXECUTIVE || "gpt-4.1",
};

/**
 * Precio por millón de tokens, configurable porque cambia con el tiempo.
 * Solo sirve para estimar el gasto y cortar a tiempo, no para facturar.
 */
function pricePerMillion(): { input: number; output: number; cachedInput: number } {
  const input = Number(process.env.OPENAI_PRICE_INPUT_PER_M ?? 0.4);
  return {
    input,
    output: Number(process.env.OPENAI_PRICE_OUTPUT_PER_M ?? 1.6),
    // OpenAI cobra los tokens de entrada que pega contra el cache automático
    // a un precio reducido (no gratis). Sin variable propia, asumimos la
    // mitad del precio de entrada normal — ajustable si el precio real
    // publicado difiere.
    cachedInput: Number(process.env.OPENAI_PRICE_CACHED_INPUT_PER_M ?? input / 2),
  };
}

/**
 * `cachedTokens` ya viene incluido en `inputTokens` (así lo reporta la API) —
 * se descuenta la porción cacheada al precio reducido en vez de cobrarla toda
 * al precio full.
 */
export function estimateCost(inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const price = pricePerMillion();
  const freshInputTokens = Math.max(0, inputTokens - cachedTokens);
  return (
    (freshInputTokens * price.input + cachedTokens * price.cachedInput + outputTokens * price.output) / 1_000_000
  );
}

/** Tope de gasto diario en USD; al superarlo se deja de analizar (manual §34). */
function dailyBudget(): number {
  return Number(process.env.AI_DAILY_BUDGET_USD ?? 2);
}

export async function spentToday(organizationId: string): Promise<number> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const result = await prisma.aiAnalysis.aggregate({
    where: { organizationId, createdAt: { gte: since } },
    _sum: { costEstimate: true },
  });

  return Number(result._sum.costEstimate ?? 0);
}

export async function isWithinBudget(organizationId: string): Promise<boolean> {
  return (await spentToday(organizationId)) < dailyBudget();
}

export class AiBudgetExceededError extends Error {
  constructor() {
    super("Se alcanzó el tope de gasto diario de IA");
    this.name = "AiBudgetExceededError";
  }
}

export interface RunOptions<T> {
  organizationId: string;
  entityType: string;
  entityId: string;
  analysisType: string;
  promptVersion: string;
  model: string;
  system: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  parse: (raw: unknown) => T;
}

/**
 * Llama al modelo pidiendo JSON con esquema estricto, valida el resultado y
 * deja registrado el consumo.
 *
 * El manual (§22) es explícito: nada de texto libre para actualizar el CRM.
 * Si el JSON no valida se reintenta una vez; si vuelve a fallar se guarda
 * como no procesado en vez de escribir datos dudosos (§36).
 */
export async function runStructured<T>(options: RunOptions<T>): Promise<T> {
  if (!isAiEnabled()) {
    throw new Error("La IA no está configurada (falta OPENAI_API_KEY)");
  }

  if (!(await isWithinBudget(options.organizationId))) {
    throw new AiBudgetExceededError();
  }

  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let lastError: unknown = null;

  // Un solo reintento: si el modelo devuelve algo que no valida dos veces,
  // insistir solo quema presupuesto.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await getClient().responses.create({
        model: options.model,
        instructions: options.system,
        input:
          attempt === 1
            ? options.input
            : `${options.input}\n\nTu respuesta anterior no cumplió el esquema. Devuelve exclusivamente el JSON pedido.`,
        text: {
          format: {
            type: "json_schema",
            name: options.schemaName,
            schema: options.schema,
            strict: true,
          },
        },
      });

      inputTokens += response.usage?.input_tokens ?? 0;
      outputTokens += response.usage?.output_tokens ?? 0;
      cachedTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;

      const parsed = options.parse(JSON.parse(response.output_text));

      await prisma.aiAnalysis.create({
        data: {
          organizationId: options.organizationId,
          entityType: options.entityType,
          entityId: options.entityId,
          analysisType: options.analysisType,
          model: options.model,
          promptVersion: options.promptVersion,
          inputTokens,
          outputTokens,
          cachedTokens,
          costEstimate: estimateCost(inputTokens, outputTokens, cachedTokens),
          result: parsed as never,
          durationMs: Date.now() - startedAt,
        },
      });

      return parsed;
    } catch (error) {
      lastError = error;
    }
  }

  await prisma.aiAnalysis.create({
    data: {
      organizationId: options.organizationId,
      entityType: options.entityType,
      entityId: options.entityId,
      analysisType: options.analysisType,
      model: options.model,
      promptVersion: options.promptVersion,
      inputTokens,
      outputTokens,
      cachedTokens,
      costEstimate: estimateCost(inputTokens, outputTokens, cachedTokens),
      error: lastError instanceof Error ? lastError.message : String(lastError),
      durationMs: Date.now() - startedAt,
    },
  });

  throw lastError;
}
