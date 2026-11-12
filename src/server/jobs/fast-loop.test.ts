import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ processJobs: vi.fn() }));
vi.mock("./index", () => ({ processJobs: m.processJobs }));

import { BOT_JOB_TYPES, FAST_LOOP_MS, startFastBotLoop, stopFastBotLoop } from "./fast-loop";

describe("latido rápido del asistente", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    m.processJobs.mockReset();
    m.processJobs.mockResolvedValue({ processed: 0, failed: 0 });
  });
  afterEach(() => {
    stopFastBotLoop();
    vi.useRealTimers();
  });

  it("cada pocos segundos procesa solo los trabajos del asistente", async () => {
    startFastBotLoop();
    await vi.advanceTimersByTimeAsync(FAST_LOOP_MS * 3);
    expect(m.processJobs).toHaveBeenCalledTimes(3);
    expect(m.processJobs).toHaveBeenCalledWith({ types: BOT_JOB_TYPES });
    expect(BOT_JOB_TYPES).toEqual(["meeting_bot_join", "vexa_bot_poll"]);
  });

  it("no se duplica si se arranca dos veces", async () => {
    startFastBotLoop();
    startFastBotLoop();
    await vi.advanceTimersByTimeAsync(FAST_LOOP_MS);
    expect(m.processJobs).toHaveBeenCalledTimes(1);
  });

  it("no empieza otra pasada mientras la anterior sigue corriendo, y se recupera de un error", async () => {
    let release: () => void = () => {};
    m.processJobs.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve({ processed: 1, failed: 0 }))));
    startFastBotLoop();
    await vi.advanceTimersByTimeAsync(FAST_LOOP_MS * 3);
    expect(m.processJobs).toHaveBeenCalledTimes(1); // la primera sigue colgada
    release();
    await vi.advanceTimersByTimeAsync(0);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m.processJobs.mockRejectedValueOnce(new Error("db caída"));
    await vi.advanceTimersByTimeAsync(FAST_LOOP_MS);
    await vi.advanceTimersByTimeAsync(FAST_LOOP_MS);
    expect(m.processJobs.mock.calls.length).toBeGreaterThanOrEqual(3); // siguió después del error
    spy.mockRestore();
  });
});
