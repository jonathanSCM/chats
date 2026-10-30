import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: vi.fn(), find: vi.fn() }));

vi.mock("@/server/auth", () => ({ auth: m.auth }));
vi.mock("@/server/db/client", () => ({ prisma: { contact: { findUnique: m.find } } }));

import { GET } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const CONTACT = {
  organizationId: "org1",
  fullName: "Ana Pérez",
  phone: "51987654321",
  email: "ana@acme.pe",
  jobTitle: "Gerente",
  city: "Lima",
  country: "Perú",
  company: { name: "Acme" },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ user: { id: "u1", organizationId: "org1" } });
  m.find.mockResolvedValue(CONTACT);
});

describe("GET /api/contacts/[id]/vcard", () => {
  it("sin sesión responde 401", async () => {
    m.auth.mockResolvedValue(null);
    expect((await GET(new Request("http://x"), ctx("c1"))).status).toBe(401);
    expect(m.find).not.toHaveBeenCalled();
  });

  it("descarga la tarjeta del contacto de su organización", async () => {
    const res = await GET(new Request("http://x"), ctx("c1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/vcard/);
    expect(res.headers.get("content-disposition")).toContain('filename="ana-perez.vcf"');
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.text();
    expect(body).toContain("FN:Ana Pérez");
    expect(body).toContain("TEL;TYPE=CELL:+51987654321");
    expect(body).toContain("ORG:Acme");
  });

  it("un contacto de OTRA organización responde igual que uno que no existe (404), sin revelar nada", async () => {
    m.find.mockResolvedValue({ ...CONTACT, organizationId: "otra" });
    const other = await GET(new Request("http://x"), ctx("c1"));
    m.find.mockResolvedValue(null);
    const missing = await GET(new Request("http://x"), ctx("c2"));
    expect(other.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await other.text()).toBe(await missing.text());
  });
});
