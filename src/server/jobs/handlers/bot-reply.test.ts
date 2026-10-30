import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  runTurn: vi.fn(),
  escalate: vi.fn(),
}));

vi.mock("@/server/services/ai/qualification-bot", () => ({ runQualificationTurn: m.runTurn, escalateAiUnavailable: m.escalate }));
vi.mock("@/server/services/ai/client", () => {
  class AiBudgetExceededError extends Error {}
  class AiCreditsError extends AiBudgetExceededError {}
  return { AiBudgetExceededError, AiCreditsError, isAiGloballyEnabled: () => true };
});

import { handleBotReply } from "./bot-reply";
import { AiBudgetExceededError, AiCreditsError } from "@/server/services/ai/client";

beforeEach(() => {
  vi.clearAllMocks();
  m.escalate.mockResolvedValue(undefined);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("handleBotReply", () => {
  it("responde normal cuando todo está bien", async () => {
    m.runTurn.mockResolvedValue(undefined);
    await handleBotReply({ conversationId: "c1" });
    expect(m.runTurn).toHaveBeenCalledWith("c1");
    expect(m.escalate).not.toHaveBeenCalled();
  });

  it("sin créditos o con el plan vencido pasa la conversación a una persona", async () => {
    m.runTurn.mockRejectedValue(new AiCreditsError("Se acabaron los créditos"));
    await expect(handleBotReply({ conversationId: "c1" })).resolves.toBeUndefined();
    expect(m.escalate).toHaveBeenCalledWith("c1", expect.stringContaining("créditos"));
  });

  it("el tope diario de la plataforma solo se omite (no es culpa del cliente)", async () => {
    m.runTurn.mockRejectedValue(new AiBudgetExceededError("tope diario"));
    await expect(handleBotReply({ conversationId: "c1" })).resolves.toBeUndefined();
    expect(m.escalate).not.toHaveBeenCalled();
  });

  it("si falla el traspaso a una persona el trabajo no se rompe", async () => {
    m.runTurn.mockRejectedValue(new AiCreditsError("sin créditos"));
    m.escalate.mockRejectedValue(new Error("db caída"));
    await expect(handleBotReply({ conversationId: "c1" })).resolves.toBeUndefined();
  });

  it("un error cualquiera sigue subiendo para que la cola reintente", async () => {
    m.runTurn.mockRejectedValue(new Error("red"));
    await expect(handleBotReply({ conversationId: "c1" })).rejects.toThrow("red");
  });
});
