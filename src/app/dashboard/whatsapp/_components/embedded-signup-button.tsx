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
        autoLogAppEvents?: boolean;
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
const SDK_LOAD_TIMEOUT_MS = 12_000;

// connect.facebook.net/.../sdk.js NO es el SDK real: es un stub de ~20
// líneas que crea `window.FB` al instante, con métodos falsos que solo
// encolan las llamadas para más tarde. El SDK de verdad llega después, en
// un segundo archivo aparte, y recién ahí reemplaza `window.FB`. Por eso
// "si window.FB existe, ya se puede usar" es falso — puede ser el stub, no
// el SDK real — y tratarlo como listo hacía que FB.init() se llamara dos
// veces (una en el stub, otra cuando llega el SDK de verdad) y que
// FB.login() cayera en medio de esa carrera con "FB.login() called before
// FB.init().". La única forma correcta de evitarlo: una sola promesa
// compartida, un solo <script>, un solo init() — nunca más de uno, nunca
// más de una vez, sin atajos basados en si `window.FB` "ya existe".
let sdkPromise: Promise<void> | null = null;

function loadFacebookSdk(appId: string): Promise<void> {
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("No se pudo cargar el SDK de Facebook a tiempo."));
      }, SDK_LOAD_TIMEOUT_MS);

      window.fbAsyncInit = () => {
        clearTimeout(timeout);
        window.FB!.init({ appId, cookie: true, xfbml: true, autoLogAppEvents: true, version: "v23.0" });
        resolve();
      };

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

    // Si falló (timeout, red, script bloqueado), no se deja la promesa
    // rechazada cacheada para siempre — un reintento debe poder volver a
    // pedir el script en vez de recibir el mismo fallo eternamente.
    sdkPromise.catch(() => {
      sdkPromise = null;
    });
  }

  return sdkPromise;
}

export function EmbeddedSignupButton({ botId }: { botId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<{ appId: string | null; configId: string | null } | null>(
    null,
  );
  const sessionRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});
  // Diagnóstico temporal: el error "no mandó waba_id/phone_number_id" no dice
  // en qué evento se cortó el flujo. Se guarda cada evento WA_EMBEDDED_SIGNUP
  // tal cual llega (consola + en pantalla) para verlo sin abrir DevTools.
  const [debugEvents, setDebugEvents] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/whatsapp/embedded-signup-config")
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig({ appId: null, configId: null }));
  }, []);

  // El SDK se precarga apenas se conoce el App ID, en vez de esperar al
  // clic — así, para cuando alguien realmente toca el botón, la promesa
  // compartida ya está resuelta (o resolviéndose) y handleClick solo
  // reutiliza esa misma promesa, sin disparar una segunda carga.
  useEffect(() => {
    if (!config?.appId) return;
    loadFacebookSdk(config.appId).catch((err) => {
      console.error("[embedded-signup] No se pudo precargar el SDK de Facebook:", err);
    });
  }, [config?.appId]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      // Log crudo de absolutamente todo mensaje que llega a la página, sin
      // filtrar por origen ni por forma — para ver si hay algo que ni
      // siquiera pasa el chequeo de origen `endsWith("facebook.com")`. Va a
      // la consola del navegador (solo la ve quien está usando el botón,
      // como cualquier log de DevTools) SIEMPRE, incluida producción — esto
      // se agregó justo para diagnosticar el flujo real de Embedded Signup,
      // que en la práctica solo se prueba en producción (vía Coolify), así
      // que apagarlo ahí lo dejaba inútil. Lo que sí queda restringido a
      // desarrollo es el panel VISIBLE en pantalla (más abajo): ese sí
      // podría exponer sin querer datos de la sesión si alguien comparte
      // una captura.
      console.log("[raw-facebook-message]", {
        origin: event.origin,
        dataType: typeof event.data,
        data: event.data,
      });

      // Antes se descartaba en silencio cualquier mensaje que no viniera de
      // un origen terminado en "facebook.com" Y que no fuera JSON parseable
      // como texto — pero si Meta manda el evento desde otro subdominio, o
      // manda `event.data` ya como objeto (no como string), ese filtro tira
      // el mensaje a la basura sin dejar rastro. Por eso ahora, mientras se
      // depura esto, se registra TODO lo que llega con origen relacionado a
      // facebook/whatsapp, sin filtrar por forma ni por tipo.
      const originLooksRelevant = /facebook\.com|whatsapp\.com|fb\.com/.test(event.origin);
      if (!originLooksRelevant) return;

      let data: unknown = event.data;
      if (typeof event.data === "string") {
        try {
          data = JSON.parse(event.data);
        } catch {
          // no era JSON — se deja tal cual (string cruda) para verla igual
        }
      }

      console.log("[embedded-signup] mensaje recibido de", event.origin, ":", data);
      if (process.env.NODE_ENV !== "production") {
        setDebugEvents((prev) =>
          [...prev, `origin=${event.origin} :: ${JSON.stringify(data).slice(0, 300)}`].slice(-10),
        );
      }

      if (
        data != null &&
        typeof data === "object" &&
        "type" in data &&
        (data as { type?: unknown }).type === "WA_EMBEDDED_SIGNUP"
      ) {
        const payload = data as { event?: string; data?: { waba_id?: string; phone_number_id?: string } };
        if (payload.event === "FINISH") {
          sessionRef.current = {
            wabaId: payload.data?.waba_id,
            phoneNumberId: payload.data?.phone_number_id,
          };
        }
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
      {debugEvents.length > 0 && (
        <div className="rounded-md border border-border/60 bg-surface-2/50 p-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            Diagnóstico (temporal) — eventos de Facebook
          </p>
          {debugEvents.map((line, i) => (
            <p key={i} className="break-all font-mono text-[10px] text-ink-muted">
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
