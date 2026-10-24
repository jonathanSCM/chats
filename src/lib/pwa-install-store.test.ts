import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (e: unknown) => void;

function fakeWindow(early?: unknown) {
  const handlers: Record<string, Handler[]> = {};
  const win = {
    __pwaInstallEvent: early,
    addEventListener: (name: string, fn: Handler) => {
      (handlers[name] ??= []).push(fn);
    },
  };
  const fire = (name: string, e: unknown) => (handlers[name] ?? []).forEach((fn) => fn(e));
  return { win, fire };
}

function installEvent(outcome: "accepted" | "dismissed") {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  };
}

describe("pwa-install-store", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda el evento de instalación y avisa a los suscriptores", async () => {
    const { win, fire } = fakeWindow();
    vi.stubGlobal("window", win);
    const store = await import("./pwa-install-store");
    const listener = vi.fn();
    store.subscribeInstall(listener);

    const ev = installEvent("accepted");
    fire("beforeinstallprompt", ev);

    expect(ev.preventDefault).toHaveBeenCalled();
    expect(store.getInstallSnapshot().event).toBe(ev);
    expect(listener).toHaveBeenCalled();
  });

  it("recupera el evento que llegó antes de que cargara la app (script temprano)", async () => {
    const early = installEvent("accepted");
    const { win } = fakeWindow(early);
    vi.stubGlobal("window", win);
    const store = await import("./pwa-install-store");
    expect(store.getInstallSnapshot().event).toBe(early);
  });

  it("promptInstall abre el diálogo y marca instalada si se acepta", async () => {
    const { win, fire } = fakeWindow();
    vi.stubGlobal("window", win);
    const store = await import("./pwa-install-store");
    store.getInstallSnapshot();
    const ev = installEvent("accepted");
    fire("beforeinstallprompt", ev);

    await expect(store.promptInstall()).resolves.toBe("accepted");
    expect(ev.prompt).toHaveBeenCalledOnce();
    expect(store.getInstallSnapshot()).toMatchObject({ event: null, installed: true });
  });

  it("si se descarta el diálogo, no queda instalada y se libera el evento", async () => {
    const { win, fire } = fakeWindow();
    vi.stubGlobal("window", win);
    const store = await import("./pwa-install-store");
    store.getInstallSnapshot();
    fire("beforeinstallprompt", installEvent("dismissed"));

    await expect(store.promptInstall()).resolves.toBe("dismissed");
    expect(store.getInstallSnapshot()).toMatchObject({ event: null, installed: false });
  });

  it("sin evento disponible no hace nada", async () => {
    const { win } = fakeWindow();
    vi.stubGlobal("window", win);
    const store = await import("./pwa-install-store");
    await expect(store.promptInstall()).resolves.toBe("unavailable");
  });

  it("appinstalled marca la app como instalada", async () => {
    const { win, fire } = fakeWindow();
    vi.stubGlobal("window", win);
    const store = await import("./pwa-install-store");
    store.getInstallSnapshot();
    fire("beforeinstallprompt", installEvent("accepted"));
    fire("appinstalled", {});
    expect(store.getInstallSnapshot()).toMatchObject({ event: null, installed: true });
  });

  it("el script temprano es ES5 y válido", () => {
    return import("./pwa-install-store").then(({ PWA_EARLY_CAPTURE_SCRIPT }) => {
      expect(() => new Function(PWA_EARLY_CAPTURE_SCRIPT)).not.toThrow();
      expect(PWA_EARLY_CAPTURE_SCRIPT).not.toMatch(/=>|\bconst\b|\blet\b|`/);
    });
  });
});
