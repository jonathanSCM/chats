import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  convFind: vi.fn(),
  oppFindMany: vi.fn(),
  oppCreate: vi.fn(),
  contactFind: vi.fn(),
  stages: vi.fn(),
  link: vi.fn(),
  assign: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    conversation: { findUnique: m.convFind },
    opportunity: { findMany: m.oppFindMany, create: m.oppCreate },
    contact: { findUnique: m.contactFind },
  },
}));
vi.mock("@/server/jobs", () => ({ enqueueOrReschedule: m.enqueue }));
vi.mock("@/server/services/pipeline", () => ({
  getOrgStages: m.stages,
  defaultEntryStage: (s: { id: string; isDefaultEntry?: boolean }[]) => s.find((x) => x.isDefaultEntry) ?? s[0],
}));
vi.mock("@/server/services/meta-attribution", () => ({ linkAttributionToOpportunity: m.link }));
vi.mock("@/server/services/lead-assignment", () => ({ autoAssignLead: m.assign }));

import { ANALYSIS_DEBOUNCE_MS, trackLeadFromMessage } from "./lead-tracking";

beforeEach(() => {
  vi.clearAllMocks();
  m.convFind.mockResolvedValue({ contactId: "c1", customerName: "Ana", customerPhone: "51999", bot: { organizationId: "org1" } });
  m.oppFindMany.mockResolvedValue([]);
  m.stages.mockResolvedValue([{ id: "s1", isDefaultEntry: true }]);
  m.contactFind.mockResolvedValue({ fullName: "Ana Pérez" });
  m.oppCreate.mockResolvedValue({ id: "op-nueva" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("trackLeadFromMessage", () => {
  it("un cliente sin ninguna oportunidad recibe su tarjeta en la etapa de entrada, atribución y reparto, y se programa el análisis", async () => {
    await trackLeadFromMessage("conv1");
    expect(m.oppCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: "org1", contactId: "c1", stageId: "s1", title: "Ana Pérez" }) }),
    );
    expect(m.link).toHaveBeenCalledWith("conv1", "op-nueva");
    expect(m.assign).toHaveBeenCalledWith({ conversationId: "conv1", opportunityId: "op-nueva" });
    const job = m.enqueue.mock.calls[0][0];
    expect(job).toMatchObject({ type: "analyze_follow_up", uniqueKey: "analyze_follow_up:op-nueva", payload: { opportunityId: "op-nueva" } });
    expect(job.runAfter.getTime()).toBeGreaterThan(Date.now() + ANALYSIS_DEBOUNCE_MS - 5000);
  });

  it("si ya tiene una tarjeta abierta no crea otra: solo reprograma su análisis (cada mensaje lo empuja hacia adelante)", async () => {
    m.oppFindMany.mockResolvedValue([{ id: "op1", archivedAt: null, stage: { role: null } }]);
    await trackLeadFromMessage("conv1");
    expect(m.oppCreate).not.toHaveBeenCalled();
    expect(m.enqueue.mock.calls[0][0]).toMatchObject({ uniqueKey: "analyze_follow_up:op1" });
  });

  it("un cliente que ya compró, perdió o se archivó no es un lead nuevo: no se le crea otra tarjeta ni se analiza", async () => {
    m.oppFindMany.mockResolvedValue([{ id: "op0", archivedAt: null, stage: { role: "WON" } }]);
    await trackLeadFromMessage("conv1");
    expect(m.oppCreate).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("sin etapa de entrada configurada o sin contacto no hace nada", async () => {
    m.stages.mockResolvedValue([]);
    await trackLeadFromMessage("conv1");
    expect(m.oppCreate).not.toHaveBeenCalled();
    m.convFind.mockResolvedValue({ contactId: null, customerName: null, customerPhone: "1", bot: { organizationId: "org1" } });
    await trackLeadFromMessage("conv1");
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("nunca lanza: un fallo se anota en el log y el mensaje del cliente se guarda igual", async () => {
    m.oppCreate.mockRejectedValue(new Error("db caída"));
    await expect(trackLeadFromMessage("conv1")).resolves.toBeUndefined();
    expect(m.enqueue).not.toHaveBeenCalled();
  });
});
