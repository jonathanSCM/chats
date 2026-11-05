import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }));

vi.mock("@/server/db/client", () => ({ prisma: { meeting: { findFirst: m.findFirst, create: m.create, update: m.update } } }));

import { isPlatformBotEmail, resolveExtensionMeeting, resolveExtensionOrganizationId } from "./extension-meeting";

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

