import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  orgFind: vi.fn(),
  create: vi.fn(),
  setSellers: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({ prisma: { organization: { findUnique: m.orgFind } } }));
vi.mock("@/server/auth/guards", () => ({ requireSession: m.session }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/server/services/suborganizations", () => ({
  createSubOrganization: m.create,
  setSubOrgSellers: m.setSellers,
}));

import { createSubOrganizationAction, setSubOrgSellersAction } from "./suborganizations";

function form(name: string, sellerIds: string[] = []): FormData {
  const f = new FormData();
  f.set("name", name);
  for (const id of sellerIds) f.append("sellerIds", id);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
  m.orgFind.mockResolvedValue({ id: "org1", parentId: null, canHaveSubOrgs: true });
  m.create.mockResolvedValue({ ok: true, id: "child1" });
  m.setSellers.mockResolvedValue({ ok: true, added: 1, removed: 0 });
});

describe("createSubOrganizationAction", () => {
  it("un vendedor no puede crear suborganizaciones", async () => {
    m.session.mockResolvedValue({ user: { id: "u2", role: "MEMBER", organizationId: "org1" } });
    const r = await createSubOrganizationAction({ error: null }, form("Norte"));
    expect(r.error).toMatch(/dueño/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("desde dentro de una suborganización no se pueden crear más", async () => {
    m.orgFind.mockResolvedValue({ id: "child1", parentId: "org1", canHaveSubOrgs: false });
    const r = await createSubOrganizationAction({ error: null }, form("Nieta"));
    expect(r.error).toMatch(/principal/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("sin la opción en el plan no se crea nada", async () => {
    m.orgFind.mockResolvedValue({ id: "org1", parentId: null, canHaveSubOrgs: false });
    const r = await createSubOrganizationAction({ error: null }, form("Norte"));
    expect(r.error).toMatch(/plan/i);
    expect(m.create).not.toHaveBeenCalled();
  });

  it("crea con el nombre y los vendedores elegidos, a nombre de la organización activa", async () => {
    const r = await createSubOrganizationAction({ error: null }, form("Norte", ["s1", "s2"]));
    expect(r.error).toBeNull();
    expect(m.create).toHaveBeenCalledWith({ parentId: "org1", name: "Norte", sellerIds: ["s1", "s2"], createdByUserId: "u1" });
    expect(m.revalidate).toHaveBeenCalledWith("/dashboard/organization");
  });

  it("devuelve el motivo si el servicio lo rechaza (por ejemplo, el máximo del plan)", async () => {
    m.create.mockResolvedValue({ ok: false, error: "Tu plan permite 2 suborganizaciones y ya tienes 2." });
    const r = await createSubOrganizationAction({ error: null }, form("Norte"));
    expect(r.error).toMatch(/permite 2/);
  });
});

describe("setSubOrgSellersAction", () => {
  it("cambia los vendedores usando siempre la organización activa como padre", async () => {
    const r = await setSubOrgSellersAction("child1", ["s1"]);
    expect(r.error).toBeNull();
    expect(m.setSellers).toHaveBeenCalledWith({ parentId: "org1", childId: "child1", sellerIds: ["s1"], byUserId: "u1" });
  });

  it("un vendedor no puede cambiarlos", async () => {
    m.session.mockResolvedValue({ user: { id: "u2", role: "MEMBER", organizationId: "org1" } });
    expect((await setSubOrgSellersAction("child1", [])).error).toMatch(/dueño/i);
    expect(m.setSellers).not.toHaveBeenCalled();
  });
});
