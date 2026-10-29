/**
 * Sondeo que espera a que termine la petición anterior antes de programar la siguiente y se
 * detiene mientras la pestaña está oculta. Con `setInterval` cada pestaña lanzaba una petición
 * nueva cada 2–3 s aunque la anterior siguiera sin responder: si el servidor tardaba más de ese
 * tiempo, las peticiones se acumulaban y la bandeja entera se volvía cada vez más lenta.
 * Con la pestaña oculta sigue sondeando, pero más espaciado (`hiddenIntervalMs`), para que el
 * sonido y los avisos de mensajes nuevos sigan funcionando en segundo plano.
 */
export function startPolling(
  run: () => Promise<unknown> | void,
  intervalMs: number,
  env: {
    hiddenIntervalMs?: number;
    isHidden?: () => boolean;
    onVisible?: (callback: () => void) => () => void;
  } = {},
): () => void {
  const isHidden = env.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
  const onVisible =
    env.onVisible ??
    ((callback: () => void) => {
      if (typeof document === "undefined") return () => {};
      const handler = () => {
        if (!document.hidden) callback();
      };
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    });

  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hiddenIntervalMs = env.hiddenIntervalMs ?? Math.max(intervalMs, 15_000);

  const schedule = () => {
    if (!stopped) timer = setTimeout(tick, isHidden() ? hiddenIntervalMs : intervalMs);
  };
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await run();
    } catch {
      // un fallo de red no corta el sondeo
    } finally {
      running = false;
      schedule();
    }
  };

  const stopVisibility = onVisible(() => {
    if (running) return;
    clearTimeout(timer);
    void tick();
  });
  schedule();

  return () => {
    stopped = true;
    clearTimeout(timer);
    stopVisibility();
  };
}
