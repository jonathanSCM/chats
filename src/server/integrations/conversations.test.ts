import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ convFindMany: vi.fn(), oppFindMany: vi.fn() }));

vi.mock("@/server/db/client", () => ({
  prisma: { conversation: { findMany: db.convFindMany }, opportunity: { findMany: db.oppFindMany } },
}));
vi.mock("@/server/integrations/auth", () => ({
  authenticateIntegration: vi.fn(async () => ({ organizationId: "orgA", keyId: "k1", scopes: ["read"] })),
}));

import { GET } from "@/app/api/integrations/v1/conversations/route";
import { serializeOpportunity } from "./serializers";

const ctx = { params: Promise.resolve({}) };
const row = (id: string, contactId: string | null, over: Record<string, unknown> = {}) => ({
  id,
  customerPhone: "+591700",
  customerName: "Carlos",
  status: "OPEN",
  assignedToId: "u1",
  contactId,
  botMemory: null,
  lastMessageAt: new Date("2026-10-15T12:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.oppFindMany.mockResolvedValue([]);
});

describe("GET /conversations: oportunidad vigente y memoria", () => {
  it("devuelve la oportunidad mas reciente de cada contacto y la memoria del bot", async () => {
    db.convFindMany.mockResolvedValue([
      row("cv1", "ct1", { botMemory: "Cliente con taller mecanico; quiere cotizacion." }),
      row("cv2", "ct2"),
      row("cv3", null),
    ]);
    // Ordenadas por updatedAt desc: para ct1 gana la primera.
    db.oppFindMany.mockResolvedValue([
      { id: "oppNueva", contactId: "ct1" },
      { id: "oppVieja", contactId: "ct1" },
    ]);
    const res = await GET(new Request("http://x/api"), ctx);
    const { data } = await res.json();
    expect(data[0]).toMatchObject({ id: "cv1", opportunityId: "oppNueva", memory: "Cliente con taller mecanico; quiere cotizacion." });
    expect(data[1]).toMatchObject({ id: "cv2", opportunityId: null, memory: null });
    expect(data[2]).toMatchObject({ id: "cv3", opportunityId: null });
  });

  it("busca oportunidades solo de la organizacion, sin archivadas, y en una sola consulta", async () => {
    db.convFindMany.mockResolvedValue([row("cv1", "ct1"), row("cv2", "ct1"), row("cv3", "ct2")]);
    await GET(new Request("http://x/api"), ctx);
    expect(db.oppFindMany).toHaveBeenCalledOnce();
    const arg = db.oppFindMany.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: "orgA", contactId: { in: ["ct1", "ct2"] }, archivedAt: null });
    expect(arg.orderBy).toEqual({ updatedAt: "desc" });
  });

  it("sin contactos no consulta oportunidades", async () => {
    db.convFindMany.mockResolvedValue([row("cv1", null)]);
    await GET(new Request("http://x/api"), ctx);
    expect(db.oppFindMany).not.toHaveBeenCalled();
  });
});

describe("serializeOpportunity: memoria del asesor IA", () => {
  const base = {
    id: "o",
    title: "t",
    contactId: "c",
    assignedToId: null,
    priority: null,
    estimatedValue: null,
    currency: "USD",
    nextAction: null,
    nextActionAt: null,
    updatedAt: new Date("2026-10-15T12:00:00Z"),
    stage: { label: "Nuevo" },
  };
  it("incluye aiMemory y needSummary (null si faltan)", () => {
    expect(serializeOpportunity({ ...base, aiMemory: "memoria", needSummary: "necesita X" })).toMatchObject({
      aiMemory: "memoria",
      needSummary: "necesita X",
    });
    expect(serializeOpportunity(base)).toMatchObject({ aiMemory: null, needSummary: null });
  });
});
