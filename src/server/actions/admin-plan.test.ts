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

import { updateOrgPlanAction } from "./admin-plan";

function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const BEFORE = {
  canHaveSubOrgs: false,
  maxSubOrgs: null,
  maxAdmins: null,
  maxSellers: null,
  canCustomizeBrand: false,
  aiOwnKeyEnabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "sa1", role: "SUPERADMIN" } });
  m.orgFind.mockResolvedValue(BEFORE);
  m.orgUpdate.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

describe("updateOrgPlanAction", () => {
  it("solo el superadmin: el dueño de una organización no puede cambiarse el plan", async () => {
    m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
    await expect(updateOrgPlanAction("org1", { error: null }, form({ maxSellers: "99" }))).rejects.toThrow(/superadmin/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("guarda topes y opciones; vacío significa sin tope", async () => {
    const r = await updateOrgPlanAction(
      "org1",
      { error: null },
      form({ maxAdmins: "2", maxSellers: "", canCustomizeBrand: "on", aiOwnKeyEnabled: "on" }),
    );
    expect(r.error).toBeNull();
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: {
        canHaveSubOrgs: false,
        maxSubOrgs: null,
        maxAdmins: 2,
        maxSellers: null,
        canCustomizeBrand: true,
        aiOwnKeyEnabled: true,
      },
    });
    expect(m.audit.mock.calls[0][0]).toMatchObject({ action: "plan_updated", before: BEFORE, userId: "sa1" });
  });

  it("sin suborganizaciones habilitadas, el tope de suborganizaciones se limpia", async () => {
    await updateOrgPlanAction("org1", { error: null }, form({ maxSubOrgs: "5" }));
    expect(m.orgUpdate.mock.calls[0][0].data.maxSubOrgs).toBeNull();
    await updateOrgPlanAction("org1", { error: null }, form({ canHaveSubOrgs: "on", maxSubOrgs: "5" }));
    expect(m.orgUpdate.mock.calls[1][0].data.maxSubOrgs).toBe(5);
  });

  it("rechaza números inválidos sin tocar nada", async () => {
    for (const bad of ["-1", "2.5", "abc", "999999"]) {
      const r = await updateOrgPlanAction("org1", { error: null }, form({ maxSellers: bad }));
      expect(r.error).toBeTruthy();
    }
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("organización inexistente", async () => {
    m.orgFind.mockResolvedValue(null);
    const r = await updateOrgPlanAction("nope", { error: null }, form({}));
    expect(r.error).toMatch(/no encontrada/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });
});
