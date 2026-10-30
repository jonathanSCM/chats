import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, phoneHref } from "./phone";

describe("phoneHref", () => {
  it("arma el enlace de llamada con el código de país", () => {
    expect(phoneHref("51987654321")).toBe("tel:+51987654321");
    expect(phoneHref("+51 987-654-321")).toBe("tel:+51987654321");
  });

  it("no hay enlace para un usuario sin número visible (BSUID) ni para valores vacíos o muy cortos", () => {
    expect(phoneHref("PE.1859282925486474")).toBeNull();
    expect(phoneHref("")).toBeNull();
    expect(phoneHref(null)).toBeNull();
    expect(phoneHref("123")).toBeNull();
  });
});

describe("formatPhoneDisplay", () => {
  it("muestra el número con el signo +", () => {
    expect(formatPhoneDisplay("51987654321")).toBe("+51987654321");
    expect(formatPhoneDisplay("+51 987-654-321")).toBe("+51987654321");
  });

  it("explica el caso del usuario sin número", () => {
    expect(formatPhoneDisplay("PE.1859282925486474")).toMatch(/sin número visible/);
  });

  it("deja tal cual lo que no parece un teléfono", () => {
    expect(formatPhoneDisplay("abc")).toBe("abc");
  });
});
