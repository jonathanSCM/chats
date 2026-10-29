import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  orgFind: vi.fn(),
  orgUpdate: vi.fn(),
  logoUpsert: vi.fn(),
  logoDelete: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/server/db/client", () => {
  const tx = {
    organization: { update: m.orgUpdate },
    organizationBrandLogo: { upsert: m.logoUpsert, deleteMany: m.logoDelete },
  };
  return {
    prisma: {
      organization: { findUnique: m.orgFind },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/server/auth/guards", () => ({ requireSession: m.session }));
vi.mock("@/server/services/audit", () => ({ audit: m.audit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));

import { updateBrandAction } from "./brand";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function form(values: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

const ORG = { canCustomizeBrand: true, brandName: null, brandColor: null, assistantName: null, brandLogoVersion: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ user: { id: "u1", role: "OWNER", organizationId: "org1" } });
  m.orgFind.mockResolvedValue(ORG);
  m.orgUpdate.mockResolvedValue({});
  m.logoUpsert.mockResolvedValue({});
  m.logoDelete.mockResolvedValue({});
  m.audit.mockResolvedValue(undefined);
});

describe("updateBrandAction", () => {
  it("un vendedor no puede cambiar la marca", async () => {
    m.session.mockResolvedValue({ user: { id: "u2", role: "MEMBER", organizationId: "org1" } });
    const r = await updateBrandAction({ error: null }, form({ brandName: "X" }));
    expect(r.error).toMatch(/dueño/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("sin el permiso del plan no guarda nada", async () => {
    m.orgFind.mockResolvedValue({ ...ORG, canCustomizeBrand: false });
    const r = await updateBrandAction({ error: null }, form({ brandName: "X" }));
    expect(r.error).toMatch(/plan/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("guarda nombre, asistente y color; vacío significa 'usar el de la plataforma'", async () => {
    const r = await updateBrandAction(
      { error: null },
      form({ brandName: " Acme ", assistantName: "Lía", brandColor: "#1d4ed8" }),
    );
    expect(r.error).toBeNull();
    expect(m.orgUpdate).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { brandName: "Acme", assistantName: "Lía", brandColor: "#1d4ed8", brandLogoVersion: 0 },
    });
    await updateBrandAction({ error: null }, form({ brandName: "", assistantName: "", brandColor: "" }));
    expect(m.orgUpdate.mock.calls[1][0].data).toMatchObject({ brandName: null, assistantName: null, brandColor: null });
  });

  it("rechaza colores mal escritos o demasiado claros", async () => {
    expect((await updateBrandAction({ error: null }, form({ brandColor: "azul" }))).error).toMatch(/#/);
    expect((await updateBrandAction({ error: null }, form({ brandColor: "#ffff00" }))).error).toMatch(/claro/i);
    expect(m.orgUpdate).not.toHaveBeenCalled();
  });

  it("sube un logo PNG real y sube la versión", async () => {
    const r = await updateBrandAction({ error: null }, form({ logo: new File([PNG], "logo.png", { type: "image/png" }) }));
    expect(r.error).toBeNull();
    expect(m.logoUpsert).toHaveBeenCalledTimes(1);
    expect(m.logoUpsert.mock.calls[0][0].create.contentType).toBe("image/png");
    expect(m.orgUpdate.mock.calls[0][0].data.brandLogoVersion).toBe(1);
  });

  it("no se deja engañar por el nombre: un SVG o HTML llamado .png se rechaza", async () => {
    const fake = new File(["<svg onload=alert(1)></svg>"], "logo.png", { type: "image/png" });
    const r = await updateBrandAction({ error: null }, form({ logo: fake }));
    expect(r.error).toMatch(/PNG, JPG o WebP/);
    expect(m.logoUpsert).not.toHaveBeenCalled();
  });

  it("rechaza logos de más de 400 KB", async () => {
    const big = new File([new Uint8Array(401 * 1024)], "logo.png", { type: "image/png" });
    const r = await updateBrandAction({ error: null }, form({ logo: big }));
    expect(r.error).toMatch(/pesa demasiado/i);
  });

  it("quitar el logo lo borra y vuelve la versión a 0", async () => {
    m.orgFind.mockResolvedValue({ ...ORG, brandLogoVersion: 4 });
    await updateBrandAction({ error: null }, form({ removeLogo: "on" }));
    expect(m.logoDelete).toHaveBeenCalledTimes(1);
    expect(m.orgUpdate.mock.calls[0][0].data.brandLogoVersion).toBe(0);
  });
});
