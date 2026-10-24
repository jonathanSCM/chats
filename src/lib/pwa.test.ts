import { describe, expect, it } from "vitest";
import {
  isIOSDevice,
  isIOSSafari,
  isNewVersion,
  installHintKind,
  isInAppBrowser,
  isMobileDevice,
} from "./pwa";

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";
const IOS_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IOS_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1";
const WHATSAPP_WEBVIEW = "Mozilla/5.0 (Linux; Android 12; SM-A525F; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
const INSTAGRAM_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

describe("installHintKind", () => {
  const base = { standalone: false, hasInstallEvent: false, legacyAndroid: false, userAgent: ANDROID_CHROME, maxTouchPoints: 5, waitedForEvent: false };

  it("con el evento de instalar: botón Instalar", () => {
    expect(installHintKind({ ...base, hasInstallEvent: true })).toBe("native");
  });
  it("con la app ya instalada (abierta como app) no muestra nada", () => {
    expect(installHintKind({ ...base, standalone: true, hasInstallEvent: true })).toBeNull();
  });
  it("Android sin evento: espera un poco y luego explica el menú", () => {
    expect(installHintKind(base)).toBeNull();
    expect(installHintKind({ ...base, waitedForEvent: true })).toBe("android-menu");
  });
  it("Android 8 o menor: explica el acceso directo aunque Chrome entregue el evento", () => {
    expect(installHintKind({ ...base, legacyAndroid: true, hasInstallEvent: true })).toBe("legacy-android");
  });
  it("iPhone con Safari: pasos de Compartir, sin esperar", () => {
    expect(installHintKind({ ...base, userAgent: IOS_SAFARI })).toBe("ios-safari");
  });
  it("iPhone con Chrome: pide abrir en Safari", () => {
    expect(installHintKind({ ...base, userAgent: IOS_CHROME })).toBe("ios-other-browser");
  });
  it("dentro de WhatsApp o Instagram: pide abrir en el navegador", () => {
    expect(installHintKind({ ...base, userAgent: WHATSAPP_WEBVIEW })).toBe("in-app-browser");
    expect(installHintKind({ ...base, userAgent: INSTAGRAM_IOS })).toBe("in-app-browser");
  });
  it("escritorio sin evento: nada", () => {
    expect(installHintKind({ ...base, userAgent: DESKTOP, maxTouchPoints: 0, waitedForEvent: true })).toBeNull();
  });
  it("escritorio con evento: botón Instalar", () => {
    expect(installHintKind({ ...base, userAgent: DESKTOP, maxTouchPoints: 0, hasInstallEvent: true })).toBe("native");
  });
});

describe("detección de dispositivo", () => {
  it("reconoce navegadores internos y móviles", () => {
    expect(isInAppBrowser(WHATSAPP_WEBVIEW)).toBe(true);
    expect(isInAppBrowser(ANDROID_CHROME)).toBe(false);
    expect(isMobileDevice(ANDROID_CHROME)).toBe(true);
    expect(isMobileDevice(DESKTOP)).toBe(false);
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
