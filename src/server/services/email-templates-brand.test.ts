import { describe, expect, it } from "vitest";
import { inviteEmail } from "./email-templates";

const base = { orgName: "Acme", inviteUrl: "https://crm.test/invite?token=x" };
const brand = { name: "Acme <b>Financiera</b>", logoUrl: "https://crm.test/api/brand-logo/o1?v=2", color: "#1d4ed8" };

describe("correo de invitación con marca propia", () => {
  it("sin marca propia conserva el logo de la plataforma", () => {
    const { html } = inviteEmail(base);
    expect(html).toContain("/logo-mark.png");
  });

  it("logo rectangular: conserva la proporción (alto fijo, ancho automático)", () => {
    const { html } = inviteEmail({ ...base, brand: { ...brand, display: "both", logoShape: "square" } });
    expect(html).toContain("height:36px; width:auto");
    expect(html).not.toContain("border-radius:50%");
  });

  it("logo redondo: círculo de 36x36", () => {
    const { html } = inviteEmail({ ...base, brand: { ...brand, logoShape: "round" } });
    expect(html).toContain("border-radius:50%");
    expect(html).toContain("object-fit:cover");
  });

  it("solo logo: no repite el nombre en la cabecera; solo nombre: no muestra el logo", () => {
    const onlyLogo = inviteEmail({ ...base, brand: { ...brand, display: "logo" } }).html;
    expect(onlyLogo).toContain("/api/brand-logo/o1");
    expect(onlyLogo).not.toContain("vertical-align:middle");
    const onlyName = inviteEmail({ ...base, brand: { ...brand, display: "name" } }).html;
    expect(onlyName).not.toContain("/api/brand-logo/o1");
    expect(onlyName).toContain("vertical-align:middle");
  });

  it("el nombre de la marca nunca mete HTML en el correo", () => {
    const { html } = inviteEmail({ ...base, brand: { ...brand, display: "both" } });
    expect(html).not.toContain("<b>Financiera</b>");
    expect(html).toContain("&lt;b&gt;Financiera&lt;/b&gt;");
  });
});
