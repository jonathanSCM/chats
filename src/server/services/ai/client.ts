import OpenAI from "openai";
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
function pricePerMillion(): { input: number; output: number } {
  return {
    input: Number(process.env.OPENAI_PRICE_INPUT_PER_M ?? 0.4),
    output: Number(process.env.OPENAI_PRICE_OUTPUT_PER_M ?? 1.6),
  };
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  const price = pricePerMillion();
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
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
          costEstimate: estimateCost(inputTokens, outputTokens),
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
      costEstimate: estimateCost(inputTokens, outputTokens),
      error: lastError instanceof Error ? lastError.message : String(lastError),
      durationMs: Date.now() - startedAt,
    },
  });

  throw lastError;
}
