import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  conversationFind: vi.fn(),
  opportunityFindFirst: vi.fn(),
  opportunityFindUnique: vi.fn(),
  meetingFindFirst: vi.fn(),
  meetingCreate: vi.fn(),
  orgFind: vi.fn(),
  transaction: vi.fn(),
  sendText: vi.fn(),
  notify: vi.fn(),
  conflict: vi.fn(),
  googleEnabled: vi.fn(),
  orgCalendar: vi.fn(),
  orgEvent: vi.fn(),
  userConnected: vi.fn(),
  userEvent: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: {
    conversation: { findUnique: m.conversationFind, update: vi.fn() },
    opportunity: { findFirst: m.opportunityFindFirst, findUnique: m.opportunityFindUnique, create: vi.fn() },
    meeting: { findFirst: m.meetingFindFirst, create: m.meetingCreate },
    organization: { findUniqueOrThrow: m.orgFind },
    message: { create: vi.fn() },
    $transaction: m.transaction,
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (v: string) => v }));
vi.mock("@/lib/brand", () => ({
  BRAND_PARENT_SELECT: {},
  botCompanyName: () => "Acme",
  resolveOrgBrand: () => ({ name: "Acme", assistantName: null }),
}));
vi.mock("@/lib/bot-guards", () => ({
  describeBookingWindow: () => "",
  clientAnsweredMeetingInvitation: () => false,
  countBotMessagesInSession: () => 0,
}));
vi.mock("@/server/services/whatsapp", () => ({ sendTextMessage: m.sendText, sendInteractiveListMessage: vi.fn() }));
vi.mock("@/server/services/push", () => ({ notifyNewMessage: m.notify }));
vi.mock("@/server/services/pipeline", () => ({ getOrgStages: vi.fn(), defaultEntryStage: vi.fn() }));
vi.mock("@/server/services/availability", () => ({
  getAvailableDays: vi.fn(),
  getAvailableSlots: vi.fn(),
  hasSchedulingConflict: m.conflict,
  formatSlotLabel: () => "viernes 6/11, 09:00",
}));
vi.mock("@/server/services/google-calendar", () => ({
  isGoogleMeetEnabled: m.googleEnabled,
  getOrCreateOrgCalendar: m.orgCalendar,
  createCalendarEvent: m.orgEvent,
}));
vi.mock("@/server/services/google-calendar-user", () => ({
  hasGoogleCalendarConnected: m.userConnected,
  createUserMeetEvent: m.userEvent,
}));
vi.mock("@/server/services/meta-attribution", () => ({ linkAttributionToOpportunity: vi.fn() }));
vi.mock("@/server/services/lead-assignment", () => ({ autoAssignLead: vi.fn() }));
vi.mock("./client", () => ({ MODELS: {}, runStructured: vi.fn() }));

import { confirmMeetingSlot } from "./qualification-bot";

const SLOT = "2026-11-06T14:00:00.000Z"; // 09:00 en Lima

function conversation(assignedToId: string | null) {
  return {
    id: "conv1",
    botPaused: false,
    botMemory: null,
    assignedToId,
    customerName: "Ana",
    customerPhone: "51999",
    aiQualificationEnabled: true,
    bot: {
      organizationId: "org1",
      aiQualificationEnabled: true,
      aiTestPhone: null,
      organization: { timezone: "America/Lima", parent: null },
      whatsappConnection: { verified: true, phoneNumberId: "pn1", accessToken: "tok" },
    },
    contact: { id: "c1", fullName: "Ana Pérez", phone: "51999", jobTitle: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.opportunityFindFirst.mockResolvedValue({ id: "op1" });
  m.opportunityFindUnique.mockResolvedValue({ assignedToId: null });
  m.meetingFindFirst.mockResolvedValue(null);
  m.meetingCreate.mockResolvedValue({ id: "mtg1" });
  m.orgFind.mockResolvedValue({ name: "Acme", bookingDurationMinutes: 30 });
  m.conflict.mockResolvedValue(false);
  m.sendText.mockResolvedValue({ messageId: "wamid" });
  m.transaction.mockResolvedValue([]);
  m.notify.mockResolvedValue(undefined);
  m.googleEnabled.mockReturnValue(true);
  m.orgCalendar.mockResolvedValue("cal-org");
  m.orgEvent.mockResolvedValue({ eventId: "ev-org" });
  m.userConnected.mockResolvedValue(false);
  m.userEvent.mockResolvedValue({ meetingUrl: null, eventId: "ev-user" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const created = () => m.meetingCreate.mock.calls[0][0].data;
const sentToClient = () => m.sendText.mock.calls.at(-1)?.[0].body as string;

describe("confirmMeetingSlot: dónde se crea el evento de Google Calendar", () => {
  it("con un vendedor asignado que conectó su Google Calendar, el evento va a SU calendario y la reunión queda ligada a él", async () => {
    m.conversationFind.mockResolvedValue(conversation("seller1"));
    m.userConnected.mockResolvedValue(true);
    await confirmMeetingSlot("conv1", SLOT);
    expect(m.userEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "seller1", timeZone: "America/Lima" }));
    expect(m.orgEvent).not.toHaveBeenCalled();
    expect(created()).toMatchObject({ googleEventId: "ev-user", googleCalendarOwnerId: "seller1" });
    expect(created().notes).not.toMatch(/Google Calendar/);
  });

  it("si el chat no tiene vendedor, usa el calendario compartido de la organización (con la zona de la organización)", async () => {
    m.conversationFind.mockResolvedValue(conversation(null));
    await confirmMeetingSlot("conv1", SLOT);
    expect(m.userEvent).not.toHaveBeenCalled();
    expect(m.orgEvent).toHaveBeenCalledWith(expect.objectContaining({ calendarId: "cal-org", timeZone: "America/Lima" }));
    expect(created()).toMatchObject({ googleEventId: "ev-org", googleCalendarOwnerId: null });
  });

  it("el vendedor sale de la oportunidad si el chat todavía no lo tiene", async () => {
    m.conversationFind.mockResolvedValue(conversation(null));
    m.opportunityFindUnique.mockResolvedValue({ assignedToId: "seller2" });
    m.userConnected.mockResolvedValue(true);
    await confirmMeetingSlot("conv1", SLOT);
    expect(m.userEvent).toHaveBeenCalledWith(expect.objectContaining({ userId: "seller2" }));
  });

  it("si falla el calendario del vendedor pero el compartido funciona, la reunión se sincroniza sin avisos de error", async () => {
    m.conversationFind.mockResolvedValue(conversation("seller1"));
    m.userConnected.mockResolvedValue(true);
    m.userEvent.mockRejectedValue(new Error("invalid_grant"));
    await confirmMeetingSlot("conv1", SLOT);
    expect(created()).toMatchObject({ googleEventId: "ev-org", googleCalendarOwnerId: null });
    expect(created().notes).not.toMatch(/No se pudo sincronizar/);
  });
});

describe("confirmMeetingSlot: cuando Google Calendar falla", () => {
  it("la reunión se guarda igual y las notas dicen por qué no se sincronizó (antes solo iba a la consola)", async () => {
    m.conversationFind.mockResolvedValue(conversation(null));
    m.orgEvent.mockRejectedValue({ code: 404, message: "Not Found" });
    await confirmMeetingSlot("conv1", SLOT);
    expect(created().googleEventId).toBeNull();
    expect(created().notes).toMatch(/⚠️ No se pudo sincronizar con Google Calendar: el calendario ya no existe en Google \(404\)/);
    expect(m.notify.mock.calls[0][0].preview).toMatch(/NO llegó a Google Calendar/);
  });

  it("si la conexión con Google venció lo dice así, para saber qué hacer", async () => {
    m.conversationFind.mockResolvedValue(conversation(null));
    m.orgCalendar.mockRejectedValue(new Error("invalid_grant: Token has been expired or revoked."));
    await confirmMeetingSlot("conv1", SLOT);
    expect(created().notes).toMatch(/vuelve a conectar el calendario/);
  });

  it("si Google no está configurado en el servidor, también queda anotado", async () => {
    m.conversationFind.mockResolvedValue(conversation(null));
    m.googleEnabled.mockReturnValue(false);
    await confirmMeetingSlot("conv1", SLOT);
    expect(created().notes).toMatch(/Google Calendar no está configurado/);
  });
});

describe("confirmMeetingSlot: zona horaria en el mensaje al cliente", () => {
  it("el cliente lee la hora junto con la zona en que está expresada", async () => {
    m.conversationFind.mockResolvedValue(conversation(null));
    await confirmMeetingSlot("conv1", SLOT);
    expect(sentToClient()).toContain("viernes 6/11, 09:00 (hora de Lima (GMT-5))");
  });
});
