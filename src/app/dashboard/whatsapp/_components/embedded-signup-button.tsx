"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    FB?: {
      init: (params: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: {
          authResponse?: { code?: string };
          status?: string;
        }) => void,
        options: {
          config_id: string;
          response_type: string;
          override_default_response_type: boolean;
          extras: {
            setup: Record<string, unknown>;
            featureType: string;
            sessionInfoVersion: string;
          };
        },
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const SDK_SRC = "https://connect.facebook.net/es_LA/sdk.js";

// Sin timeout ni onerror, un bloqueador de anuncios/rastreadores (uBlock,
// Brave Shields, etc. — muy común que bloqueen justo connect.facebook.net)
// dejaba la promesa colgada para siempre: el botón se quedaba en "Cargando…"
// sin ningún error ni forma de reintentar sin recargar la página entera.
const SDK_LOAD_TIMEOUT_MS = 12_000;

// `window.FB` puede existir (el script ya cargó, de este intento o de uno
// anterior) sin que FB.init() se haya llamado todavía — y llamar FB.login()
// antes de init() falla en seco ("FB.login() called before FB.init()."). Por
// eso este flag, no la sola presencia de window.FB, es lo que dice si ya se
// puede loguear.
let fbInitialized = false;

function loadFacebookSdk(appId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    function initNow() {
      window.FB!.init({ appId, cookie: true, xfbml: false, version: "v23.0" });
      fbInitialized = true;
      resolve();
    }

    if (fbInitialized) {
      resolve();
      return;
    }

    if (window.FB) {
      // El script ya está cargado (de un intento anterior) — solo falta
      // llamar init() en este.
      initNow();
      return;
    }

    const timeout = setTimeout(() => {
      reject(new Error("No se pudo cargar el SDK de Facebook a tiempo."));
    }, SDK_LOAD_TIMEOUT_MS);

    window.fbAsyncInit = () => {
      clearTimeout(timeout);
      initNow();
    };

    // Si ya hay una etiqueta de un intento anterior que nunca terminó de
    // cargar, se reemplaza — así un reintento vuelve a pedir el script en
    // vez de esperar por una carga que ya sabemos que no va a llegar.
    document.getElementById("facebook-jssdk")?.remove();

    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = SDK_SRC;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("No se pudo descargar el SDK de Facebook."));
    };
    document.body.appendChild(script);
  });
}

export function EmbeddedSignupButton({ botId }: { botId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{ appId: string | null; configId: string | null } | null>(
    null,
  );
  const sessionRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  useEffect(() => {
    fetch("/api/whatsapp/embedded-signup-config")
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig({ appId: null, configId: null }));
  }, []);

  // El SDK se carga apenas se conoce el App ID — no al hacer clic. Cargarlo
  // e iniciar sesión casi en el mismo instante (ambos disparados por un
  // solo clic) hacía que FB.login() corriera antes de que el SDK
  // terminara de asentar su estado interno tras FB.init(), y tiraba "FB.login()
  // called before FB.init()." aunque init() ya se hubiera llamado. Dándole
  // el tiempo normal de carga de página de por medio, ese caso no se da.
  useEffect(() => {
    if (!config?.appId) return;
    loadFacebookSdk(config.appId).catch((err) => {
      console.error("[embedded-signup] No se pudo precargar el SDK de Facebook:", err);
    });
  }, [config?.appId]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = JSON.parse(event.data);
        if (data.type === "WA_EMBEDDED_SIGNUP" && data.event === "FINISH") {
          sessionRef.current = {
            wabaId: data.data?.waba_id,
            phoneNumberId: data.data?.phone_number_id,
          };
        }
      } catch {
        // mensajes que no son JSON (otros widgets de FB) — se ignoran
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  async function handleLoginResponse(response: {
    authResponse?: { code?: string };
    status?: string;
  }) {
    const code = response.authResponse?.code;
    if (!code) {
      setStatus("idle");
      return;
    }

    const { wabaId, phoneNumberId } = sessionRef.current;
    if (!wabaId || !phoneNumberId) {
      setError(
        "Meta no mandó el waba_id/phone_number_id esperado. Intenta de nuevo — si persiste, revisa la configuración de Embedded Signup en tu app de Meta.",
      );
      setStatus("error");
      return;
    }

    setStatus("connecting");
    try {
      const res = await fetch("/api/whatsapp/embedded-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, wabaId, phoneNumberId, botId }),
      });
      const data = (await res.json()) as { error: string | null };
      if (!res.ok || data.error) {
        setError(data.error ?? "No se pudo completar la conexión.");
        setStatus("error");
        return;
      }
      router.refresh();
      setStatus("idle");
    } catch {
      setError("No se pudo completar la conexión con el servidor.");
      setStatus("error");
    }
  }

  async function handleClick() {
    const appId = config?.appId;
    const configId = config?.configId;
    if (!appId || !configId) {
      setError("Faltan WHATSAPP_APP_ID / WHATSAPP_CONFIG_ID en el servidor.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      await loadFacebookSdk(appId);
    } catch {
      setError(
        "No se pudo cargar el SDK de Facebook. Si tienes un bloqueador de anuncios o de " +
          "rastreadores (uBlock Origin, Brave Shields, extensiones de privacidad), desactívalo " +
          "para este sitio e intenta de nuevo.",
      );
      setStatus("error");
      return;
    }

    // El callback de FB.login() tiene que ser una función normal, no async:
    // el SDK de Facebook valida el tipo y rechaza una que devuelva una
    // Promise ("Expression is of type asyncfunction, not function"), sin
    // abrir el diálogo y sin ningún error visible más que en la consola.
    // Por eso la lógica async vive aparte, en handleLoginResponse.
    window.FB!.login(
      (response) => {
        void handleLoginResponse(response);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="secondary"
        onClick={handleClick}
        disabled={status === "loading" || status === "connecting"}
        className="w-full"
      >
        <Smartphone size={16} />
        {status === "loading" && "Cargando…"}
        {status === "connecting" && "Conectando…"}
        {(status === "idle" || status === "error") &&
          "Conectar con Coexistence (mismo número que ya usas en el celular)"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
