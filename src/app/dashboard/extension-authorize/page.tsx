import { getOrCreateMyExtensionTokenAction } from "@/server/actions/extension-auth";
import { ExtensionAuthorizeBridge } from "./bridge";

/**
 * Página que abre la extensión de subtítulos de Meet para identificarse --
 * reusa la sesión ya iniciada del CRM (esta página vive bajo /dashboard, así
 * que el layout ya exige estar logueado) en vez de pedir usuario/contraseña
 * de nuevo o hacer que alguien pegue un token a mano. Un content script de
 * la extensión (authorize-bridge.js, matches solo esta URL) lee el token del
 * DOM y lo guarda en chrome.storage.local.
 */
export default async function ExtensionAuthorizePage() {
  const { token, name } = await getOrCreateMyExtensionTokenAction();

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-lg font-semibold text-ink">Extensión de subtítulos de Meet</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {name ? `Conectando como ${name}…` : "Conectando…"}
      </p>
      {/* El content script de la extensión lee estos data-* -- no se
          renderiza nada sensible visualmente, el token solo vive en el DOM. */}
      <div id="mext-token-bridge" data-token={token} data-name={name ?? ""} hidden />
      <ExtensionAuthorizeBridge />
    </div>
  );
}
