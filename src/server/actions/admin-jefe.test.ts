import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ prisma: { organization: { findUnique: m.orgFind, update: m.orgUpdate } } }));
vi.mock("@/server/auth/guards", () => ({
  requireSession: m.session,
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
// Dependencias de otras acciones del mismo archivo: no se usan aqui.
vi.mock("@/server/services/mailer", () => ({ sendMail: vi.fn() }));
vi.mock("@/server/services/email-templates", () => ({ inviteEmail: vi.fn() }));
vi.mock("@/server/services/organization-membership", () => ({ addMembership: vi.fn(), removeMembership: vi.fn() }));

import { toggleOrgJefeAction } from "./admin";

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "sa1", role: "SUPERADMIN" } });
  m.orgFind.mockResolvedValue({ jefeEnabled: false });
  m.orgUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

describe("toggleOrgJefeAction", () => {
  it("solo el superadmin: un Admin de organizacion no puede habilitarse el Jefe a si mismo", async () => {
    m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
    await expect(toggleOrgJefeAction("org1", true)).rejects.toThrow(/superadmin/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("habilita, audita antes/despues y refresca las pantallas", async () => {
    const r = await toggleOrgJefeAction("org1", true);
    expect(r).toEqual({ error: null });
    expect(m.orgUpdate).toHaveBeenCalledWith({ where: { id: "org1" }, data: { jefeEnabled: true } });
    expect(m.audit.mock.calls[0][0]).toMatchObject({
      entityType: "Organization",
      entityId: "org1",
      action: "jefe_enabled",
      userId: "sa1",
      before: { jefeEnabled: false },
      after: { jefeEnabled: true },
    });
    expect(m.revalidate).toHaveBeenCalledWith("/admin/organizations/org1");
    expect(m.revalidate).toHaveBeenCalledWith("/dashboard/organization");
  });

  it("deshabilita", async () => {
    m.orgFind.mockResolvedValue({ jefeEnabled: true });
    await toggleOrgJefeAction("org1", false);
    expect(m.orgUpdate).toHaveBeenCalledWith({ where: { id: "org1" }, data: { jefeEnabled: false } });
    expect(m.audit.mock.calls[0][0].action).toBe("jefe_disabled");
  });

  it("si ya esta en ese estado no escribe ni audita", async () => {
    m.orgFind.mockResolvedValue({ jefeEnabled: true });
    expect(await toggleOrgJefeAction("org1", true)).toEqual({ error: null });
    expect(m.orgUpdate).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });

  it("organizacion inexistente: error, sin escribir", async () => {
    m.orgFind.mockResolvedValue(null);
    expect(await toggleOrgJefeAction("nada", true)).toEqual({ error: "Organización no encontrada" });
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });
});
