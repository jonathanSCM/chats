import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/server/db/client", () => ({ prisma: { meeting: { findFirst: m.findFirst } } }));

import { isPlatformBotEmail, resolveExtensionOrganizationId } from "./extension-meeting";

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
