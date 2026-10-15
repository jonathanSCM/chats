import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  messageFind: vi.fn(),
  meetingFindMany: vi.fn(),
  meetingFind: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    message: { findUnique: db.messageFind },
    meeting: { findMany: db.meetingFindMany, findUnique: db.meetingFind },
  },
}));
vi.mock("./events", async (orig) => ({
  ...(await orig<typeof import("./events")>()),
  emitIntegrationEvent: db.emit,
}));

import { emitMeetingSummaryReady, emitMessageCreated, emitSettledMeetingTranscripts } from "./domain-events";

const probeWith = (webhooks: { id: string }[]) => ({
  conversation: { bot: { organization: { integrationWebhooks: webhooks } } },
});

const fullMessage = {
  id: "g1",
  conversationId: "cv1",
  role: "CUSTOMER",
  content: "Necesito la cotizacion para el viernes",
  mediaType: null,
  createdAt: new Date("2026-10-15T14:03:11Z"),
  conversation: {
    assignedToId: "u1",
    customerPhone: "+59170000000",
    customerName: "Carlos WA",
    bot: { organizationId: "orgA" },
    contact: { id: "ct1", fullName: "Carlos", phone: "+59170000000", opportunities: [{ id: "opp1" }] },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.emit.mockResolvedValue(undefined);
});

describe("emitMessageCreated", () => {
  it("sin webhook activo: una sola consulta liviana y no emite", async () => {
    db.messageFind.mockResolvedValueOnce(probeWith([]));
    await emitMessageCreated("g1");
    expect(db.messageFind).toHaveBeenCalledTimes(1);
    expect(db.emit).not.toHaveBeenCalled();
  });

  it("mensaje inexistente: no emite ni lanza", async () => {
    db.messageFind.mockResolvedValueOnce(null);
    await expect(emitMessageCreated("nada")).resolves.toBeUndefined();
    expect(db.emit).not.toHaveBeenCalled();
  });

  it("con webhook activo: carga el detalle y emite message.created con el contacto y la oportunidad", async () => {
    db.messageFind.mockResolvedValueOnce(probeWith([{ id: "w1" }])).mockResolvedValueOnce(fullMessage);
    await emitMessageCreated("g1");
    expect(db.messageFind).toHaveBeenCalledTimes(2);
    expect(db.emit).toHaveBeenCalledOnce();
    expect(db.emit.mock.calls[0][0]).toMatchObject({
      eventId: "msg_g1",
      type: "message.created",
      organizationId: "orgA",
      data: {
        conversationId: "cv1",
        messageId: "g1",
        role: "CUSTOMER",
        text: "Necesito la cotizacion para el viernes",
        contact: { id: "ct1", name: "Carlos", phone: "+59170000000" },
        opportunityId: "opp1",
        assignedToId: "u1",
      },
    });
  });

  it("texto vacío (media pura) viaja como null", async () => {
    db.messageFind
      .mockResolvedValueOnce(probeWith([{ id: "w1" }]))
      .mockResolvedValueOnce({ ...fullMessage, content: "  ", mediaType: "IMAGE" });
    await emitMessageCreated("g1");
    expect(db.emit.mock.calls[0][0].data).toMatchObject({ text: null, mediaType: "IMAGE" });
  });

  it("NUNCA lanza: un error de base no rompe el flujo de WhatsApp", async () => {
    db.messageFind.mockRejectedValueOnce(new Error("db caida"));
    await expect(emitMessageCreated("g1")).resolves.toBeUndefined();
  });
});

describe("emitSettledMeetingTranscripts", () => {
  const now = new Date("2026-10-15T20:00:00Z");
  const meeting = (over: Record<string, unknown> = {}) => ({
    id: "m1",
    organizationId: "orgA",
    title: "Reunion con Carlos",
    scheduledAt: new Date("2026-10-15T15:00:00Z"),
    transcript: "Ana: te envio la cotizacion el viernes",
    audioTranscript: null,
    notes: null,
    opportunityId: "opp1",
    ...over,
  });

  it("filtra por ventana de 24 h, asentadas (10 min) y organizaciones con webhook activo", async () => {
    db.meetingFindMany.mockResolvedValueOnce([]);
    await emitSettledMeetingTranscripts(now);
    const where = db.meetingFindMany.mock.calls[0][0].where;
    expect(where.updatedAt.gt).toEqual(new Date("2026-10-14T20:00:00Z"));
    expect(where.updatedAt.lt).toEqual(new Date("2026-10-15T19:50:00Z"));
    expect(where.organization).toEqual({ integrationWebhooks: { some: { enabled: true } } });
  });

  it("emite meeting.transcript_ready con la carga que espera el Jefe", async () => {
    db.meetingFindMany.mockResolvedValueOnce([meeting()]);
    expect(await emitSettledMeetingTranscripts(now)).toBe(1);
    const ev = db.emit.mock.calls[0][0];
    expect(ev).toMatchObject({ type: "meeting.transcript_ready", organizationId: "orgA" });
    expect(ev.eventId).toMatch(/^mtr_m1_[0-9a-f]{12}$/);
    expect(ev.data).toEqual({
      meetingId: "m1",
      title: "Reunion con Carlos",
      scheduledAt: "2026-10-15T15:00:00.000Z",
      transcript: "Ana: te envio la cotizacion el viernes",
      audioTranscript: null,
      notes: null,
      opportunityId: "opp1",
    });
  });

  it("título vacío → 'Reunión' (nunca null); mismo texto → mismo eventId", async () => {
    db.meetingFindMany.mockResolvedValue([meeting({ title: null }), meeting({ title: null })]);
    await emitSettledMeetingTranscripts(now);
    expect(db.emit.mock.calls[0][0].data.title).toBe("Reunión");
    expect(db.emit.mock.calls[0][0].eventId).toBe(db.emit.mock.calls[1][0].eventId);
  });

  it("texto corregido genera otro eventId (se reemite)", async () => {
    db.meetingFindMany.mockResolvedValue([meeting(), meeting({ transcript: "Ana: te envio la cotizacion el lunes" })]);
    await emitSettledMeetingTranscripts(now);
    expect(db.emit.mock.calls[0][0].eventId).not.toBe(db.emit.mock.calls[1][0].eventId);
  });

  it("sin ningún texto no emite", async () => {
    db.meetingFindMany.mockResolvedValueOnce([meeting({ transcript: null, audioTranscript: null, notes: "   " })]);
    await emitSettledMeetingTranscripts(now);
    expect(db.emit).not.toHaveBeenCalled();
  });
});

describe("emitMeetingSummaryReady", () => {
  it("emite con el aiSummaryAt como versión del eventId", async () => {
    const at = new Date("2026-10-15T16:00:00Z");
    db.meetingFind.mockResolvedValueOnce({
      id: "m1",
      organizationId: "orgA",
      aiSummary: "Resumen",
      aiSummaryData: { resumen: "x" },
      aiSummaryAt: at,
    });
    await emitMeetingSummaryReady("m1");
    expect(db.emit.mock.calls[0][0]).toMatchObject({
      eventId: `msr_m1_${at.getTime()}`,
      type: "meeting.summary_ready",
      data: { meetingId: "m1", aiSummary: "Resumen", aiSummaryAt: at.toISOString() },
    });
  });

  it("sin resumen todavía no emite; y no lanza ante errores", async () => {
    db.meetingFind.mockResolvedValueOnce({ id: "m1", organizationId: "orgA", aiSummary: null, aiSummaryData: null, aiSummaryAt: null });
    await emitMeetingSummaryReady("m1");
    expect(db.emit).not.toHaveBeenCalled();
    db.meetingFind.mockRejectedValueOnce(new Error("boom"));
    await expect(emitMeetingSummaryReady("m1")).resolves.toBeUndefined();
  });
});
