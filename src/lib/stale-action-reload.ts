/**
 * Cuando se redespliega la app, cualquiera que ya tenía una pestaña abierta
 * sigue con JS viejo en el navegador que apunta a Server Actions de un
 * build anterior (el ID de la acción cambia en cada build). El servidor
 * nuevo no la reconoce y tira "Failed to find Server Action" / "Server
 * Reference ID did not match the expected format". Antes había que avisarle
 * a mano a cada usuario que recargara -- esto detecta el error apenas
 * ocurre y recarga la página sola, una sola vez por sesión de pestaña para
 * no entrar en loop si el error persistiera por otra causa.
 */

const STALE_ACTION_PATTERN = /failed to find server action|server reference id did not match|failed-to-find-server-action/i;

function looksLikeStaleAction(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const digest = error instanceof Error ? (error as { digest?: string }).digest : undefined;
  return STALE_ACTION_PATTERN.test(message) || (!!digest && STALE_ACTION_PATTERN.test(digest));
}

function reloadOnce(): void {
  const key = "staleActionReloadedAt";
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 10_000) return; // ya se intentó hace poco, no entrar en loop
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
}

export function installStaleActionReload(): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (looksLikeStaleAction(event.reason)) reloadOnce();
  };
  const onError = (event: ErrorEvent) => {
    if (looksLikeStaleAction(event.error)) reloadOnce();
  };
  window.addEventListener("unhandledrejection", onRejection);
  window.addEventListener("error", onError);
  return () => {
    window.removeEventListener("unhandledrejection", onRejection);
    window.removeEventListener("error", onError);
  };
}

export { looksLikeStaleAction, reloadOnce };
