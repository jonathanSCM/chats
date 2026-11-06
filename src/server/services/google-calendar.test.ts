import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgFindUniqueOrThrow: vi.fn(),
  orgFindFirst: vi.fn(),
  orgUpdate: vi.fn(),
  calGet: vi.fn(),
  calInsert: vi.fn(),
  eventInsert: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: { organization: { findUniqueOrThrow: m.orgFindUniqueOrThrow, findFirst: m.orgFindFirst, update: m.orgUpdate } },
}));
vi.mock("googleapis", () => ({
  google: {
    auth: { OAuth2: class { setCredentials() {} } },
    calendar: () => ({ calendars: { get: m.calGet, insert: m.calInsert }, events: { insert: m.eventInsert } }),
  },
}));

import { createCalendarEvent, getOrCreateOrgCalendar } from "./google-calendar";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = "id";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.GOOGLE_BOT_REFRESH_TOKEN = "refresh";
  m.orgUpdate.mockResolvedValue({});
});

describe("getOrCreateOrgCalendar", () => {
  it("si el calendario guardado todavía existe, lo reutiliza sin crear otro", async () => {
    m.orgFindUniqueOrThrow.mockResolvedValue({ googleCalendarId: "cal-viejo", timezone: "America/Lima" });
    m.calGet.mockResolvedValue({ data: {} });
    await expect(getOrCreateOrgCalendar("org1", "Acme")).resolves.toBe("cal-viejo");
    expect(m.calInsert).not.toHaveBeenCalled();
  });

  it("si el calendario guardado ya no existe en Google (404), crea uno nuevo con la zona de la organización y guarda su id", async () => {
    m.orgFindUniqueOrThrow.mockResolvedValue({ googleCalendarId: "cal-borrado", timezone: "America/Lima" });
    m.calGet.mockRejectedValue({ code: 404 });
    m.calInsert.mockResolvedValue({ data: { id: "cal-nuevo" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(getOrCreateOrgCalendar("org1", "Acme")).resolves.toBe("cal-nuevo");
    expect(m.calInsert).toHaveBeenCalledWith({ requestBody: { summary: "Acme — Reuniones", timeZone: "America/Lima" } });
    expect(m.orgUpdate).toHaveBeenCalledWith({ where: { id: "org1" }, data: { googleCalendarId: "cal-nuevo" } });
    warn.mockRestore();
  });

  it("un error que no es 'no existe' (red, permisos) no se confunde con calendario perdido: se propaga", async () => {
    m.orgFindUniqueOrThrow.mockResolvedValue({ googleCalendarId: "cal", timezone: "America/Lima" });
    m.calGet.mockRejectedValue({ code: 500 });
    await expect(getOrCreateOrgCalendar("org1", "Acme")).rejects.toMatchObject({ code: 500 });
    expect(m.calInsert).not.toHaveBeenCalled();
  });

  it("sin calendario guardado, crea uno", async () => {
    m.orgFindUniqueOrThrow.mockResolvedValue({ googleCalendarId: null, timezone: "America/La_Paz" });
    m.calInsert.mockResolvedValue({ data: { id: "cal-nuevo" } });
    await expect(getOrCreateOrgCalendar("org1", "Acme")).resolves.toBe("cal-nuevo");
    expect(m.calGet).not.toHaveBeenCalled();
  });
});

describe("createCalendarEvent: zona horaria del evento", () => {
  const base = { calendarId: "cal1", summary: "Reunión", scheduledAt: new Date("2026-11-06T14:00:00.000Z"), durationMinutes: 30 };

  it("marca el evento con la zona que se indica, además del instante exacto en UTC", async () => {
    m.eventInsert.mockResolvedValue({ data: { id: "ev1" } });
    await createCalendarEvent({ ...base, timeZone: "America/Lima" });
    const body = m.eventInsert.mock.calls[0][0].requestBody;
    expect(body.start).toEqual({ dateTime: "2026-11-06T14:00:00.000Z", timeZone: "America/Lima" });
    expect(body.end).toEqual({ dateTime: "2026-11-06T14:30:00.000Z", timeZone: "America/Lima" });
  });

  it("sin zona explícita usa la de la organización dueña de ese calendario", async () => {
    m.eventInsert.mockResolvedValue({ data: { id: "ev1" } });
    m.orgFindFirst.mockResolvedValue({ timezone: "America/La_Paz" });
    await createCalendarEvent(base);
    expect(m.orgFindFirst).toHaveBeenCalledWith({ where: { googleCalendarId: "cal1" }, select: { timezone: true } });
    expect(m.eventInsert.mock.calls[0][0].requestBody.start.timeZone).toBe("America/La_Paz");
  });
});
