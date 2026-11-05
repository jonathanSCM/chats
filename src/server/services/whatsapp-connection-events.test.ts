import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  audit: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
  prisma: { whatsAppConnection: { findMany: m.findMany, findUnique: m.findUnique, updateMany: m.updateMany } },
}));
vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("@/lib/crypto", () => ({ decrypt: (v: string) => `dec:${v}` }));
vi.mock("@/server/services/whatsapp", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/whatsapp")>("@/server/services/whatsapp");
  return { ...actual, unsubscribeAppFromWaba: m.unsubscribe };
});

import { handleAccountUpdate, unsubscribeConnectionFromMeta } from "./whatsapp-connection-events";
import { describeDisconnection } from "./whatsapp";

const update = (over: Partial<Parameters<typeof handleAccountUpdate>[0]> = {}) => ({
  wabaId: "waba1",
  phoneNumber: "+51929234847",
  event: "PARTNER_REMOVED",
  disconnectionReason: null as string | null,
  disconnectionInitiatedBy: "USER" as string | null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.updateMany.mockResolvedValue({ count: 1 });
  m.audit.mockResolvedValue(undefined);
});

describe("describeDisconnection", () => {
  it("dice en palabras de una persona quién y por qué", () => {
    expect(describeDisconnection(null, "USER")).toBe("Se desconectó desde la app de WhatsApp Business del celular.");
    expect(describeDisconnection("PRIMARY_INACTIVITY", "SYSTEM")).toMatch(/Meta desconectó el número: el celular principal/);
    expect(describeDisconnection("COMPANION_INACTIVITY", "SYSTEM")).toMatch(/dispositivo vinculado/);
    expect(describeDisconnection("BUSINESS_DOWNGRADE", "SYSTEM")).toMatch(/plan de WhatsApp Business/);
    expect(describeDisconnection(null, null)).toBe("El número se desconectó de la plataforma.");
  });
});

describe("handleAccountUpdate", () => {
  it("PARTNER_REMOVED: la conexión queda desconectada con el motivo, y se audita", async () => {
    m.findMany.mockResolvedValue([{ id: "c1", botId: "b1", bot: { organizationId: "org1" } }]);
    await expect(handleAccountUpdate(update())).resolves.toBe(1);
    expect(m.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { wabaId: "waba1", verified: true } }));
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["c1"] } },
      data: expect.objectContaining({ verified: false, disconnectReason: expect.stringMatching(/celular/) }),
    });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "whatsapp_partner_removed", organizationId: "org1", actor: "SYSTEM" }));
  });

  it("otros eventos (ACCOUNT_OFFBOARDED, etc.) no tocan nada", async () => {
    await expect(handleAccountUpdate(update({ event: "ACCOUNT_OFFBOARDED" }))).resolves.toBe(0);
    expect(m.findMany).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it("si no hay ninguna conexión activa con esa cuenta, no hace nada", async () => {
    m.findMany.mockResolvedValue([]);
    await expect(handleAccountUpdate(update())).resolves.toBe(0);
    expect(m.updateMany).not.toHaveBeenCalled();
  });
});

describe("unsubscribeConnectionFromMeta", () => {
  it("cancela la suscripción con el token descifrado cuando la conexión sigue activa", async () => {
    m.findUnique.mockResolvedValue({ wabaId: "waba1", accessToken: "tok", verified: true });
    await unsubscribeConnectionFromMeta("b1");
    expect(m.unsubscribe).toHaveBeenCalledWith({ wabaId: "waba1", accessToken: "dec:tok" });
  });

  it("no intenta nada si Meta ya la desconectó o no hay cuenta", async () => {
    m.findUnique.mockResolvedValue({ wabaId: "waba1", accessToken: "tok", verified: false });
    await unsubscribeConnectionFromMeta("b1");
    m.findUnique.mockResolvedValue({ wabaId: null, accessToken: "tok", verified: true });
    await unsubscribeConnectionFromMeta("b1");
    expect(m.unsubscribe).not.toHaveBeenCalled();
  });

  it("si Meta lo rechaza, no lanza: la desconexión local sigue", async () => {
    m.findUnique.mockResolvedValue({ wabaId: "waba1", accessToken: "tok", verified: true });
    m.unsubscribe.mockRejectedValue(new Error("(400) no soportado"));
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(unsubscribeConnectionFromMeta("b1")).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
