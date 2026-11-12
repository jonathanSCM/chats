import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  meetingFind: vi.fn(),
  meetingUpdate: vi.fn(),
  attachmentCreate: vi.fn(),
  attachmentFind: vi.fn(),
  meetingUpdateMany: vi.fn(),
  reschedule: vi.fn(),
  enqueue: vi.fn(),
  saveMedia: vi.fn(),
  fetch: vi.fn(),
  charge: vi.fn(),
  usageFind: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    meeting: { findUnique: m.meetingFind, update: m.meetingUpdate, updateMany: m.meetingUpdateMany },
    meetingAttachment: { create: m.attachmentCreate, findFirst: m.attachmentFind },
    aiCreditUsage: { findFirst: m.usageFind },
  },
}));
vi.mock("../queue", () => ({ enqueue: m.enqueue, enqueueOrReschedule: m.reschedule }));
vi.mock("@/lib/media-storage", () => ({ saveMediaFile: m.saveMedia }));
vi.mock("@/server/services/ai/credits", () => ({ chargeCredits: m.charge }));

import { SHOT_REASONS } from "@/lib/bot-shot";
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
  m.attachmentFind.mockResolvedValue(null);
  m.meetingUpdateMany.mockResolvedValue({ count: 1 });
  m.reschedule.mockResolvedValue(undefined);
  m.enqueue.mockResolvedValue(undefined);
  m.saveMedia.mockResolvedValue("/media/x.txt");
  m.charge.mockResolvedValue(undefined);
  m.usageFind.mockResolvedValue(null);
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

describe("handleVexaBotPoll (créditos por transcripción)", () => {
  const ended = (minutes: number) => ({
    organizationId: "org1",
    botJoinedAt: new Date(Date.now() - minutes * 60_000),
    botLeftAt: new Date(),
    vexaSessionId: 5,
    transcript: null,
  });

  it("al terminar bien registra los minutos de la llamada sin costo de créditos", async () => {
    m.meetingFind.mockResolvedValue(ended(60));
    vexa([entry({ id: 5, status: "completed" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 5 }));
    expect(m.charge).toHaveBeenCalledTimes(1);
    expect(m.charge).toHaveBeenCalledWith({
      organizationId: "org1",
      feature: "transcripcion",
      credits: 0,
      audioMinutes: 60,
      entityId: "mtg1",
    });
  });

  it("no cobra dos veces la misma reunión", async () => {
    m.meetingFind.mockResolvedValue(ended(30));
    m.usageFind.mockResolvedValue({ id: "u1" });
    vexa([entry({ id: 5, status: "completed" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 5 }));
    expect(m.charge).not.toHaveBeenCalled();
  });

  it("no cobra si la reunión falló", async () => {
    m.meetingFind.mockResolvedValue(ended(30));
    vexa([entry({ id: 5, status: "failed" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 5 }));
    expect(m.charge).not.toHaveBeenCalled();
  });

  it("si el cobro falla la reunión igual queda guardada", async () => {
    m.meetingFind.mockResolvedValue(ended(10));
    m.charge.mockRejectedValue(new Error("db caída"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vexa([entry({ id: 5, status: "completed" })]);
    await expect(handleVexaBotPoll(payload({ vexaSessionId: 5 }))).resolves.toBeUndefined();
    expect(m.meetingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ botStatus: "DONE" }) }));
    spy.mockRestore();
  });
});

describe("handleVexaBotPoll (entrada fallida y sala de espera)", () => {
  const failedEntry = (reason: string, over: Record<string, unknown> = {}) =>
    entry({ id: 7, status: "failed", failure_stage: "joining", data: { join_evidence: { reason } }, ...over });
  const meetingRow = (over: Record<string, unknown> = {}) => ({
    status: "CONFIRMED",
    botStatus: "JOINING",
    createdAt: new Date(Date.now() - 30 * 60_000),
    scheduledAt: new Date(Date.now() - 20 * 60_000),
    durationMinutes: 60,
    meetingUrl: "https://meet.google.com/abc-defg-hij",
    ...over,
  });

  it("marca 'esperando que lo admitan' mientras el asistente está en la sala de espera", async () => {
    vexa([entry({ id: 7, status: "awaiting_admission" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.meetingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { botStatus: "WAITING_ADMISSION" } }),
    );
    expect(m.enqueue).toHaveBeenCalledTimes(1); // sigue mirando
  });

  it("si Meet no mostró la sala, vuelve a pedir el asistente y no lo da por fallido", async () => {
    m.meetingFind.mockResolvedValue(meetingRow());
    vexa([failedEntry("never_reached_lobby")]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.reschedule).toHaveBeenCalledWith(
      expect.objectContaining({ type: "meeting_bot_join", payload: { meetingId: "mtg1", attempt: 1 } }),
    );
    expect(m.meetingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { botStatus: "PENDING", botFailureReason: null } }));
  });

  it("el primer reintento es rápido (15 s) y el siguiente espera más", async () => {
    m.meetingFind.mockResolvedValue(meetingRow());
    vexa([failedEntry("never_reached_lobby")]);
    const before = Date.now();
    await handleVexaBotPoll(payload({ vexaSessionId: 7, joinAttempt: 0 }));
    const first = (m.reschedule.mock.calls[0][0] as { runAfter: Date }).runAfter.getTime() - before;
    expect(first).toBeGreaterThanOrEqual(14_000);
    expect(first).toBeLessThan(20_000);
    m.reschedule.mockClear();
    await handleVexaBotPoll(payload({ vexaSessionId: 7, joinAttempt: 1 }));
    expect((m.reschedule.mock.calls[0][0] as { runAfter: Date }).runAfter.getTime() - Date.now()).toBeGreaterThan(40_000);
  });

  it("si Google bloqueó al invitado («You can't join this video call») reintenta en vez de darlo por perdido", async () => {
    m.meetingFind.mockResolvedValue(meetingRow());
    vexa([
      entry({
        id: 7,
        status: "failed",
        failure_stage: "awaiting_admission",
        data: { join_evidence: { reason: "awaiting_admission_rejected", detail: "Google Meet blocked the guest: You can't join this video call" } },
      }),
    ]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.reschedule).toHaveBeenCalledWith(expect.objectContaining({ type: "meeting_bot_join", payload: { meetingId: "mtg1", attempt: 1 } }));
  });

  it("si una captura ya anotó que Meet lo mandó a su página de inicio, igual reintenta y borra ese motivo", async () => {
    m.meetingFind.mockResolvedValue(meetingRow({ botFailureReason: SHOT_REASONS.inactive }));
    vexa([failedEntry("stopped_while_joining")]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.reschedule).toHaveBeenCalledWith(expect.objectContaining({ payload: { meetingId: "mtg1", attempt: 1 } }));
    expect(m.meetingUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { botStatus: "PENDING", botFailureReason: null } }));
  });

  it("un rechazo del anfitrión (no el bloqueo de Google) no se reintenta", async () => {
    m.meetingFind.mockResolvedValue(meetingRow());
    vexa([
      entry({ id: 7, status: "failed", failure_stage: "awaiting_admission", data: { join_evidence: { reason: "awaiting_admission_rejected", detail: "Bot admission was rejected by meeting admin" } } }),
    ]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.reschedule).not.toHaveBeenCalled();
  });

  it("si el motivo anotado es el de iniciar sesión (cuenta de Google obligatoria) no insiste", async () => {
    m.meetingFind.mockResolvedValue(meetingRow({ botFailureReason: SHOT_REASONS["sign-in"] }));
    vexa([failedEntry("stopped_while_joining")]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.reschedule).not.toHaveBeenCalled();
  });

  it("tras agotar los reintentos queda FAILED con el motivo a la vista", async () => {
    m.meetingFind.mockResolvedValue(meetingRow());
    vexa([failedEntry("never_reached_lobby")]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7, joinAttempt: 3 }));
    expect(m.reschedule).not.toHaveBeenCalled();
    expect(m.meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ botStatus: "FAILED", botFailureReason: expect.stringMatching(/Meet no dejó/) }) }),
    );
  });

  it("si nadie lo admitió en una reunión 'en vivo', no insiste", async () => {
    m.meetingFind.mockResolvedValue(meetingRow({ createdAt: new Date(), scheduledAt: new Date() }));
    vexa([failedEntry("awaiting_admission_timeout", { failure_stage: "awaiting_admission" })]);
    await handleVexaBotPoll(payload({ vexaSessionId: 7 }));
    expect(m.reschedule).not.toHaveBeenCalled();
    expect(m.meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ botFailureReason: expect.stringMatching(/Nadie admitió/) }) }),
    );
  });

  it("no duplica la transcripción si el trabajo se repite", async () => {
    m.attachmentFind.mockResolvedValue({ id: "a1" });
    m.meetingFind.mockResolvedValue({ botJoinedAt: new Date(), vexaSessionId: null, transcript: "hola" });
    vexa([entry({ id: 5, status: "completed" })], { segments: [{ speaker: "A", text: "hola" }], recordings: [] });
    await handleVexaBotPoll(payload({ vexaSessionId: 5 }));
    expect(m.attachmentCreate).not.toHaveBeenCalled();
  });
});

