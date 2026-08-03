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

function loadFacebookSdk(appId: string): Promise<void> {
  return new Promise((resolve) => {
    if (window.FB) {
      resolve();
      return;
    }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, cookie: true, xfbml: false, version: "v21.0" });
      resolve();
    };
    if (document.getElementById("facebook-jssdk")) return;
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = SDK_SRC;
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  });
}

export function EmbeddedSignupButton({ botId }: { botId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "connecting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
  const configId = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;

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

  async function handleClick() {
    if (!appId || !configId) {
      setError(
        "Faltan NEXT_PUBLIC_WHATSAPP_APP_ID / NEXT_PUBLIC_WHATSAPP_CONFIG_ID en el servidor.",
      );
      setStatus("error");
      return;
    }

    setStatus("loading");
    setError(null);
    await loadFacebookSdk(appId);

    window.FB!.login(
      async (response) => {
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
