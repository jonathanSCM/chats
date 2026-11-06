import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), memberFind: vi.fn(), memberMany: vi.fn() }));

vi.mock("@/server/db/client", () => ({
  prisma: {
    meeting: { findFirst: m.findFirst, create: m.create, update: m.update },
    organizationMembership: { findUnique: m.memberFind, findMany: m.memberMany },
  },
}));

import { ExtensionMeetingNotFoundError, cleanMeetingTitle, isPlatformBotEmail, resolveExtensionMeeting, resolveExtensionOrg, resolveExtensionOrganizationId } from "./extension-meeting";

const bot = { organizationId: "org-proshop", email: "meet-captions@internal.proshop.lat" };
const person = { organizationId: "org-proshop", email: "vendedora@ejemplo.com" };

beforeEach(() => vi.clearAllMocks());

describe("isPlatformBotEmail", () => {
  it("solo la cuenta interna del asistente", () => {
    expect(isPlatformBotEmail(bot.email)).toBe(true);
    expect(isPlatformBotEmail(person.email)).toBe(false);
  });
});

describe("resolveExtensionOrganizationId", () => {
  it("una persona trabaja siempre en su organización (no se busca nada)", async () => {
    await expect(resolveExtensionOrganizationId(person, "https://meet.google.com/abc-defg-hij")).resolves.toBe("org-proshop");
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it("el asistente usa la organización de la reunión con asistente que tiene ese link, aunque el token sea de otra", async () => {
    m.findFirst.mockResolvedValue({ organizationId: "org-test" });
    await expect(resolveExtensionOrganizationId(bot, "https://meet.google.com/meet/abc-defg-hij")).resolves.toBe("org-test");
    expect(m.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ meetingUrl: { contains: "abc-defg-hij", mode: "insensitive" }, botStatus: { not: null } }) }),
    );
  });

  it("si no hay ninguna reunión con ese link, cae en la organización del token", async () => {
    m.findFirst.mockResolvedValue(null);
    await expect(resolveExtensionOrganizationId(bot, "https://meet.google.com/abc-defg-hij")).resolves.toBe("org-proshop");
    await expect(resolveExtensionOrganizationId(bot, "no es un link")).resolves.toBe("org-proshop");
  });
});

describe("por id de sesión del asistente", () => {
  it("la organización sale de la reunión con ESA sesión, aunque otra organización use el mismo link", async () => {
    m.findFirst.mockResolvedValueOnce({ organizationId: "org-peru" });
    await expect(resolveExtensionOrganizationId(bot, "https://meet.google.com/abc-defg-hij", 321)).resolves.toBe("org-peru");
    expect(m.findFirst).toHaveBeenCalledTimes(1);
    expect(m.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vexaSessionId: 321 } }));
  });

  it("si la sesión todavía no está guardada, usa el link como respaldo", async () => {
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ organizationId: "org-test" });
    await expect(resolveExtensionOrganizationId(bot, "https://meet.google.com/abc-defg-hij", 999)).resolves.toBe("org-test");
  });

  it("una persona ignora el id de sesión: trabaja en su organización", async () => {
    await expect(resolveExtensionOrganizationId(person, "https://meet.google.com/abc-defg-hij", 321)).resolves.toBe("org-proshop");
    expect(m.findFirst).not.toHaveBeenCalled();
  });

  it("la reunión se encuentra por la sesión dentro de la organización, sin crear una suelta", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "mtg-exacta", transcript: null, audioTranscript: null });
    const resolved = await resolveExtensionMeeting({ organizationId: "org-peru", meetingUrl: "https://meet.google.com/abc-defg-hij", vexaSessionId: 321 });
    expect(resolved.id).toBe("mtg-exacta");
    expect(m.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-peru", vexaSessionId: 321 }) }));
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe("resolveExtensionOrg (persona con varias organizaciones)", () => {
  const me = { id: "u1", organizationId: "org-a", email: "vendedora@ejemplo.com" };
  const url = "https://meet.google.com/abc-defg-hij";

  it("usa la organización que ELIGIÓ si pertenece a ella (reunión de emergencia, sin agendar)", async () => {
    m.memberFind.mockResolvedValue({ id: "mem1" });
    await expect(resolveExtensionOrg({ user: me, meetingUrl: url, requestedOrganizationId: "org-b" })).resolves.toEqual({ ok: true, organizationId: "org-b" });
    expect(m.memberFind).toHaveBeenCalledWith(expect.objectContaining({ where: { userId_organizationId: { userId: "u1", organizationId: "org-b" } } }));
  });

  it("rechaza una organización a la que no pertenece", async () => {
    m.memberFind.mockResolvedValue(null);
    await expect(resolveExtensionOrg({ user: me, meetingUrl: url, requestedOrganizationId: "org-ajena" })).resolves.toEqual({ ok: false, error: expect.stringMatching(/No perteneces/) });
  });

  it("si elige la activa no consulta nada más", async () => {
    await expect(resolveExtensionOrg({ user: me, meetingUrl: url, requestedOrganizationId: "org-a" })).resolves.toEqual({ ok: true, organizationId: "org-a" });
    expect(m.memberFind).not.toHaveBeenCalled();
  });

  it("sin elegir: la organización activa si ahí está agendada la reunión", async () => {
    m.findFirst.mockResolvedValueOnce({ id: "mtg" });
    await expect(resolveExtensionOrg({ user: me, meetingUrl: url })).resolves.toEqual({ ok: true, organizationId: "org-a" });
  });

  it("sin elegir: otra organización suya donde la reunión ya está agendada", async () => {
    m.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ organizationId: "org-b" });
    m.memberMany.mockResolvedValue([{ organizationId: "org-a" }, { organizationId: "org-b" }]);
    await expect(resolveExtensionOrg({ user: me, meetingUrl: url })).resolves.toEqual({ ok: true, organizationId: "org-b" });
  });

  it("sin elegir y sin agendar en ninguna: la activa", async () => {
    m.findFirst.mockResolvedValue(null);
    m.memberMany.mockResolvedValue([{ organizationId: "org-a" }, { organizationId: "org-b" }]);
    await expect(resolveExtensionOrg({ user: me, meetingUrl: url })).resolves.toEqual({ ok: true, organizationId: "org-a" });
  });

  it("la cuenta interna del asistente no pasa por aquí: sigue su propia regla", async () => {
    m.findFirst.mockResolvedValueOnce({ organizationId: "org-peru" });
    const bot = { id: "bot", organizationId: "org-proshop", email: "meet-captions@internal.proshop.lat" };
    await expect(resolveExtensionOrg({ user: bot, meetingUrl: url, vexaSessionId: 5, requestedOrganizationId: "org-otra" })).resolves.toEqual({ ok: true, organizationId: "org-peru" });
    expect(m.memberFind).not.toHaveBeenCalled();
  });
});

describe("nombre de la reunión", () => {
  const base = { organizationId: "org-a", meetingUrl: "https://meet.google.com/abc-defg-hij" };

  it("limpia espacios y recorta; vacío = sin nombre", () => {
    expect(cleanMeetingTitle("  Demo   con  Ana \n")).toBe("Demo con Ana");
    expect(cleanMeetingTitle("   ")).toBeNull();
    expect(cleanMeetingTitle(null)).toBeNull();
    expect(cleanMeetingTitle("x".repeat(300))).toHaveLength(160);
  });

  it("una reunión nueva se guarda con el nombre que le puso la persona", async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: "nueva", transcript: null, audioTranscript: null });
    await resolveExtensionMeeting({ ...base, title: "Demo con Ana" });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "Demo con Ana" }) }));
  });

  it("sin nombre sigue llamándose «Reunión Extensión»", async () => {
    m.findFirst.mockResolvedValue(null);
    m.create.mockResolvedValue({ id: "nueva", transcript: null, audioTranscript: null });
    await resolveExtensionMeeting({ ...base, title: "  " });
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ title: "Reunión Extensión" }) }));
  });

  it("una reunión que tenía nombre automático lo cambia por el nuevo", async () => {
    m.findFirst.mockResolvedValue({ id: "e1", title: "Reunión en vivo", transcript: null, audioTranscript: null, recordedById: "u1" });
    await resolveExtensionMeeting({ ...base, title: "Demo con Ana" });
    expect(m.update).toHaveBeenCalledWith({ where: { id: "e1" }, data: { title: "Demo con Ana" } });
  });

  it("una reunión agendada o ya renombrada conserva su nombre", async () => {
    m.findFirst.mockResolvedValue({ id: "e2", title: "Reunión con Liliana", transcript: null, audioTranscript: null, recordedById: "u1" });
    await resolveExtensionMeeting({ ...base, title: "Otro nombre" });
    expect(m.update).not.toHaveBeenCalled();
  });
});

describe("solo buscar (asistente de Vexa)", () => {
  const base = { organizationId: "org-a", meetingUrl: "https://meet.google.com/abc-defg-hij" };

  it("si la reunión no es del CRM, no crea una suelta: lanza el error para descartar lo recibido", async () => {
    m.findFirst.mockResolvedValue(null);
    await expect(resolveExtensionMeeting({ ...base, onlyExisting: true })).rejects.toBeInstanceOf(ExtensionMeetingNotFoundError);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("si la reunión existe, la devuelve igual que siempre", async () => {
    m.findFirst.mockResolvedValue({ id: "e1", title: "Demo", transcript: null, audioTranscript: null, recordedById: "u1" });
    await expect(resolveExtensionMeeting({ ...base, onlyExisting: true })).resolves.toMatchObject({ id: "e1" });
  });
});

