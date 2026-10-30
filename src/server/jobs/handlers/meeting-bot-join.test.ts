import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  meetingFind: vi.fn(),
  meetingFindMany: vi.fn(),
  meetingUpdate: vi.fn(),
  meetingUpdateMany: vi.fn(),
  enqueue: vi.fn(),
  fetch: vi.fn(),
  credits: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    meeting: { findUnique: m.meetingFind, findMany: m.meetingFindMany, update: m.meetingUpdate, updateMany: m.meetingUpdateMany },
  },
}));
vi.mock("../queue", () => ({ enqueueOrReschedule: m.enqueue }));
vi.mock("@/server/services/ai/credits", () => ({ getOrgCredits: m.credits }));
vi.mock("@/server/services/ai/credits", () => ({ getOrgCredits: m.credits }));

import { handleMeetingBotJoin } from "./meeting-bot-join";

const MEETING = {
  id: "mtg1",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  status: "SCHEDULED",
  organizationId: "org1",
  vexaSessionId: null as number | null,
  organization: {
    id: "org1",
    name: "Acme",
    canCustomizeBrand: false,
    brandName: null,
    brandColor: null,
    assistantName: null,
    brandLogoVersion: 0,
    parent: null,
  },
};

const json = (status: number, body: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) } as Response);

/** Respuestas de Vexa por (método, ruta). */
function vexa(opts: { post: Promise<Response>; list?: unknown[] }) {
  m.fetch.mockImplementation((url: string, init?: { method?: string }) => {
    if (init?.method === "POST") return opts.post;
    return json(200, { meetings: opts.list ?? [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VEXA_API_URL = "http://vexa.test";
  process.env.VEXA_API_KEY = "k";
  vi.stubGlobal("fetch", m.fetch);
  m.meetingFind.mockResolvedValue({ ...MEETING });
  m.meetingFindMany.mockResolvedValue([]);
  m.meetingUpdate.mockResolvedValue({});
  m.meetingUpdateMany.mockResolvedValue({ count: 1 });
  m.enqueue.mockResolvedValue(undefined);
  m.credits.mockResolvedValue(null); // sin plan de créditos
});

describe("handleMeetingBotJoin (identificador de sesión)", () => {
  it("guarda el id de la sesión que devuelve Vexa y lo pasa al seguimiento", async () => {
    vexa({ post: json(201, { id: 82, status: "requested" }) });
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.meetingUpdate).toHaveBeenCalledWith({ where: { id: "mtg1" }, data: { vexaSessionId: 82, botStatus: "JOINING" } });
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({ meetingId: "mtg1", nativeMeetingId: "abc-defg-hij", vexaSessionId: 82 });
  });

  it("si Vexa no devuelve el id, busca la sesión recién creada para esa sala", async () => {
    const now = new Date().toISOString();
    vexa({
      post: json(201, {}),
      list: [
        { id: 70, platform: "google_meet", native_meeting_id: "abc-defg-hij", status: "completed", created_at: "2020-01-01T00:00:00Z" },
        { id: 85, platform: "google_meet", native_meeting_id: "abc-defg-hij", status: "requested", created_at: now },
      ],
    });
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.meetingUpdate.mock.calls[0][0].data.vexaSessionId).toBe(85);
    expect(m.enqueue.mock.calls[0][0].payload.vexaSessionId).toBe(85);
  });

  it("409: adopta la sesión si otra reunión de la MISMA organización ya la tiene", async () => {
    m.meetingFindMany.mockResolvedValue([{ vexaSessionId: 90 }]);
    vexa({ post: json(409, {}), list: [{ id: 90, platform: "google_meet", native_meeting_id: "abc-defg-hij", status: "active", created_at: new Date().toISOString() }] });
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.meetingUpdate).toHaveBeenCalledWith({ where: { id: "mtg1" }, data: { vexaSessionId: 90 } });
    expect(m.meetingUpdateMany).toHaveBeenCalled(); // pasa de pendiente a "uniéndose" sin pisar un estado más avanzado
    expect(m.enqueue.mock.calls[0][0].payload.vexaSessionId).toBe(90);
  });

  it("409: NO adopta la sesión de otra organización; marca la reunión como fallida y no sigue", async () => {
    m.meetingFindMany.mockResolvedValue([]); // esta organización no tiene esa sesión
    vexa({ post: json(409, {}), list: [{ id: 90, platform: "google_meet", native_meeting_id: "abc-defg-hij", status: "active", created_at: new Date().toISOString() }] });
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.meetingUpdate).toHaveBeenCalledWith({ where: { id: "mtg1" }, data: { botStatus: "FAILED" } });
    expect(m.enqueue).not.toHaveBeenCalled();
    // el id de la otra organización jamás se guarda en esta reunión
    expect(JSON.stringify(m.meetingUpdate.mock.calls)).not.toContain("vexaSessionId");
  });

  it("409 sin ninguna sesión activa a la vista: reintenta más tarde (lanza)", async () => {
    vexa({ post: json(409, {}), list: [] });
    await expect(handleMeetingBotJoin({ meetingId: "mtg1" })).rejects.toThrow(/todavía no aparece/);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("un error real de Vexa sigue siendo un fallo reintentable", async () => {
    vexa({ post: json(500, {}) });
    await expect(handleMeetingBotJoin({ meetingId: "mtg1" })).rejects.toThrow(/500/);
  });

  it("una reunión que ya tenía su sesión la conserva al recibir 409", async () => {
    m.meetingFind.mockResolvedValue({ ...MEETING, vexaSessionId: 90 });
    vexa({ post: json(409, {}), list: [{ id: 90, platform: "google_meet", native_meeting_id: "abc-defg-hij", status: "joining", created_at: new Date().toISOString() }] });
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.enqueue.mock.calls[0][0].payload.vexaSessionId).toBe(90);
  });
});

describe("handleMeetingBotJoin (créditos de IA)", () => {
  it("sin créditos disponibles el asistente no entra: se marca como fallida y no se llama a Vexa", async () => {
    m.credits.mockResolvedValue({ balance: { available: 0 } });
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.meetingUpdate).toHaveBeenCalledWith({ where: { id: "mtg1" }, data: { botStatus: "FAILED" } });
    expect(m.fetch).not.toHaveBeenCalled();
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("con créditos el flujo sigue igual", async () => {
    m.credits.mockResolvedValue({ balance: { available: 50 } });
    m.fetch.mockReturnValueOnce(json(201, { id: 7 }));
    await handleMeetingBotJoin({ meetingId: "mtg1" });
    expect(m.fetch).toHaveBeenCalled();
  });
});
