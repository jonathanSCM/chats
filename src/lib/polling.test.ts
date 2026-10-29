import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPolling } from "./polling";

describe("startPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("no lanza otra petición mientras la anterior sigue pendiente", async () => {
    let calls = 0;
    let finish!: () => void;
    const run = () => {
      calls++;
      return new Promise<void>((resolve) => (finish = resolve));
    };
    const stop = startPolling(run, 1000, { isHidden: () => false, onVisible: () => () => {} });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000); // el servidor tarda: no se acumulan pedidos
    expect(calls).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    stop();
  });

  it("con la pestaña oculta sondea más espaciado y al volver pide de inmediato", async () => {
    let hidden = true;
    let visible!: () => void;
    const run = vi.fn(async () => {});
    const stop = startPolling(run, 1000, {
      hiddenIntervalMs: 10_000,
      isHidden: () => hidden,
      onVisible: (cb) => ((visible = cb), () => {}),
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(1); // sigue avisando de mensajes nuevos, pero cada 10 s
    hidden = false;
    visible();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it("sigue sondeando aunque una petición falle y se detiene al limpiar", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("red")).mockResolvedValue(undefined);
    const stop = startPolling(run, 1000, { isHidden: () => false, onVisible: () => () => {} });
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
