import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  meetingFind: vi.fn(),
  meetingUpdate: vi.fn(),
  attachmentCreate: vi.fn(),
  enqueue: vi.fn(),
  saveMedia: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: { meeting: { findUnique: m.meetingFind, update: m.meetingUpdate }, meetingAttachment: { create: m.attachmentCreate } },
}));
vi.mock("../queue", () => ({ enqueue: m.enqueue }));
vi.mock("@/lib/media-storage", () => ({ saveMediaFile: m.saveMedia }));

import { handleVexaBotPoll } from "./vexa-bot-poll";

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const entry = (over: Record<string, unknown>) => ({
  id: 1,
  platform: "google_meet",
  native_meeting_id: "abc-defg-hij",
  status: "active",
  created_at: iso(10),
  updated_at: iso(1),
  ...over,
});

const json = (body: unknown, ok = true) => Promise.resolve({ ok, status: ok ? 200 : 404, json: () => Promise.resolve(body) } as Response);

function vexa(list: unknown[], transcript: unknown = { segments: [], recordings: [] }) {
  m.fetch.mockImplementation((url: string) => {
    if (url.endsWith("/bots")) return json({ meetings: list });
    return json(transcript);
  });
}

const payload = (extra: Record<string, unknown> = {}) => ({
  meetingId: "mtg1",
  nativeMeetingId: "abc-defg-hij",
  startedAt: iso(12),
  ...extra,
});

const urlsCalled = () => m.fetch.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.VEXA_API_URL = "http://vexa.test";
  process.env.VEXA_API_KEY = "k";
  vi.stubGlobal("fetch", m.fetch);
  m.meetingFind.mockResolvedValue({ botJoinedAt: new Date(), vexaSessionId: null, transcript: null });
  m.meetingUpdate.mockResolvedValue({});
  m.attachmentCreate.mockResolvedValue({});
  m.enqueue.mockResolvedValue(undefined);
  m.saveMedia.mockResolvedValue("/media/x.txt");
});

describe("handleVexaBotPoll (por sesión, no por sala)", () => {
  it("sigue SU sesión aunque haya otra más nueva en la misma sala", async () => {
    vexa([entry({ id: 82, status: "active" }), entry({ id: 83, status: "completed", created_at: iso(2), updated_at: iso(0) })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 82 }));
    // la sesión 82 sigue activa: no se trata como terminada por culpa de la 83
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({ vexaSessionId: 82 });
    expect(urlsCalled().some((u) => u.includes("/transcripts/"))).toBe(false);
  });

  it("al terminar, baja la transcripción de ESA sesión por su id (no la de toda la sala)", async () => {
    vexa(
      [entry({ id: 82, status: "completed" }), entry({ id: 83, status: "active", created_at: iso(2) })],
      { segments: [{ speaker: "Ana", text: "Hola equipo" }], recordings: [] },
    );
    await handleVexaBotPoll(payload({ vexaSessionId: 82 }));
    const transcriptCalls = urlsCalled().filter((u) => u.includes("/transcripts/"));
    expect(transcriptCalls).toEqual(["http://vexa.test/transcripts/by-id/82"]);
    expect(m.meetingUpdate).toHaveBeenLastCalledWith({
      where: { id: "mtg1" },
      data: { botStatus: "DONE", audioTranscript: "Ana: Hola equipo" },
    });
  });

  it("si su sesión todavía no aparece, espera: no se queda con otra sesión de la misma sala", async () => {
    vexa([entry({ id: 83, status: "completed" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 82 }));
    expect(m.enqueue).toHaveBeenCalledTimes(1);
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({ vexaSessionId: 82 });
    expect(urlsCalled().some((u) => u.includes("/transcripts/"))).toBe(false);
    expect(m.meetingUpdate).not.toHaveBeenCalled();
  });

  it("reuniones iniciadas antes de este cambio (sin id): encuentra la sesión de esa vuelta y se la guarda", async () => {
    vexa([entry({ id: 70, status: "completed", created_at: iso(60 * 24) }), entry({ id: 85, status: "active", created_at: iso(10) })]);
    await handleVexaBotPoll(payload());
    expect(m.meetingUpdate).toHaveBeenCalledWith({ where: { id: "mtg1" }, data: { vexaSessionId: 85 } });
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({ vexaSessionId: 85 });
  });

  it("usa el id guardado en la reunión si el job no lo trae", async () => {
    m.meetingFind.mockResolvedValue({ botJoinedAt: new Date(), vexaSessionId: 82, transcript: null });
    vexa([entry({ id: 82, status: "active" }), entry({ id: 83, status: "completed", created_at: iso(2) })]);
    await handleVexaBotPoll(payload());
    expect(m.enqueue.mock.calls[0][0].payload).toMatchObject({ vexaSessionId: 82 });
  });

  it("el estado 'activo' marca que el bot ya está grabando (una vez)", async () => {
    m.meetingFind.mockResolvedValue({ botJoinedAt: null, vexaSessionId: 82, transcript: null });
    vexa([entry({ id: 82, status: "active" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 82 }));
    expect(m.meetingUpdate).toHaveBeenCalledWith({
      where: { id: "mtg1" },
      data: expect.objectContaining({ botStatus: "RECORDING" }),
    });
  });
});
