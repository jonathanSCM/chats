import { describe, expect, it } from "vitest";
import {
  DISMISS_DAYS,
  isInstallDismissed,
  isIOSDevice,
  isIOSSafari,
  isNewVersion,
  parseDismissRecord,
  shouldOfferInstall,
} from "./pwa";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

describe("parseDismissRecord", () => {
  it("lee un registro válido", () => {
    expect(parseDismissRecord(JSON.stringify({ v: "abc", t: 5 }))).toEqual({ v: "abc", t: 5 });
  });
  it("ignora datos vacíos o corruptos", () => {
    expect(parseDismissRecord(null)).toBeNull();
    expect(parseDismissRecord("no es json")).toBeNull();
    expect(parseDismissRecord(JSON.stringify({ v: 1, t: "x" }))).toBeNull();
  });
});

describe("isInstallDismissed", () => {
  it("respeta el 'Ahora no' en la misma versión", () => {
    expect(isInstallDismissed({ v: "v1", t: NOW - 2 * DAY }, "v1", NOW)).toBe(true);
  });
  it("vuelve a ofrecer cuando hay una versión nueva", () => {
    expect(isInstallDismissed({ v: "v1", t: NOW - DAY }, "v2", NOW)).toBe(false);
  });
  it("vuelve a ofrecer cuando pasó el tiempo", () => {
    expect(isInstallDismissed({ v: "v1", t: NOW - (DISMISS_DAYS + 1) * DAY }, "v1", NOW)).toBe(false);
  });
  it("sin registro no está descartado", () => {
    expect(isInstallDismissed(null, "v1", NOW)).toBe(false);
  });
});

describe("shouldOfferInstall", () => {
  const base = { standalone: false, hasInstallEvent: true, iosSafari: false, dismissed: false };
  it("ofrece cuando el navegador permite instalar", () => {
    expect(shouldOfferInstall(base)).toBe(true);
  });
  it("no ofrece si ya está instalada (abierta como app)", () => {
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false);
  });
  it("no ofrece si se descartó", () => {
    expect(shouldOfferInstall({ ...base, dismissed: true })).toBe(false);
  });
  it("no ofrece si el navegador no soporta instalar", () => {
    expect(shouldOfferInstall({ ...base, hasInstallEvent: false })).toBe(false);
  });
  it("en Safari de iOS ofrece las instrucciones aunque no haya evento", () => {
    expect(shouldOfferInstall({ ...base, hasInstallEvent: false, iosSafari: true })).toBe(true);
  });
});

describe("iOS", () => {
  const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const chromeIos = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
  const ipadOs = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
  it("detecta iPhone y iPad", () => {
    expect(isIOSDevice(safari)).toBe(true);
    expect(isIOSDevice(ipadOs, 5)).toBe(true);
    expect(isIOSDevice(ipadOs, 0)).toBe(false);
  });
  it("solo Safari puede agregar a inicio", () => {
    expect(isIOSSafari(safari)).toBe(true);
    expect(isIOSSafari(chromeIos)).toBe(false);
  });
});

describe("isNewVersion", () => {
  it("detecta un identificador distinto", () => {
    expect(isNewVersion("abc", "def")).toBe(true);
  });
  it("no avisa si es el mismo o falta el dato", () => {
    expect(isNewVersion("abc", "abc")).toBe(false);
    expect(isNewVersion("abc", null)).toBe(false);
    expect(isNewVersion("abc", undefined)).toBe(false);
  });
  it("no avisa en desarrollo", () => {
    expect(isNewVersion("dev", "abc")).toBe(false);
    expect(isNewVersion("abc", "dev")).toBe(false);
  });
});
