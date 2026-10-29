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

  it("no pide nada con la pestaña oculta y retoma al volver", async () => {
    let hidden = true;
    let visible!: () => void;
    const run = vi.fn(async () => {});
    const stop = startPolling(run, 1000, { isHidden: () => hidden, onVisible: (cb) => ((visible = cb), () => {}) });
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).not.toHaveBeenCalled();
    hidden = false;
    visible();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
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
