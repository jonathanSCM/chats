"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { loadFacebookSdk } from "@/lib/facebook-sdk";
import { selectMetaAdAccountAction, disconnectMetaAdsAction } from "@/server/actions/organization";

interface AdAccount {
  id: string;
  name: string;
}

export function MetaAdsConnect({
  accountName,
  accountId,
  connected,
  needsReconnect,
  pendingAccounts,
}: {
  accountName: string | null;
  accountId: string | null;
  connected: boolean;
  needsReconnect: boolean;
  pendingAccounts: AdAccount[];
}) {
  const router = useRouter();
  const [config, setConfig] = useState<{ appId: string | null; metaAdsConfigId: string | null } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "connecting" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [choices, setChoices] = useState<AdAccount[]>(pendingAccounts);
  const [chosenId, setChosenId] = useState(pendingAccounts[0]?.id ?? "");

  useEffect(() => {
    fetch("/api/whatsapp/embedded-signup-config")
      .then((res) => res.json())
      .then(setConfig)
      .catch(() => setConfig({ appId: null, metaAdsConfigId: null }));
  }, []);

  useEffect(() => {
    if (!config?.appId) return;
    loadFacebookSdk(config.appId).catch(() => {});
  }, [config?.appId]);

  async function completeConnection(accessToken: string) {
    setStatus("connecting");
    try {
      const res = await fetch("/api/meta-ads/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessToken }),
      });
      const data = (await res.json()) as { error: string | null; accounts?: AdAccount[] };
      if (!res.ok || data.error) {
        setError(data.error ?? "No se pudo completar la conexión.");
        setStatus("idle");
        return;
      }
      if (data.accounts && data.accounts.length > 0) {
        setChoices(data.accounts);
        setChosenId(data.accounts[0].id);
      }
      setStatus("idle");
      router.refresh();
    } catch {
      setError("No se pudo completar la conexión con el servidor.");
      setStatus("idle");
    }
  }

  async function handleConnect() {
    const appId = config?.appId;
    const configId = config?.metaAdsConfigId;
    if (!appId || !configId) {
      setError("Falta el Config ID de Meta Ads en la configuración de plataforma (/admin/settings).");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await loadFacebookSdk(appId);
    } catch {
      setError("No se pudo cargar el SDK de Facebook. Si tenés un bloqueador de anuncios o rastreadores, desactivalo para este sitio.");
      setStatus("idle");
      return;
    }
    // El callback de FB.login() no puede ser async (el SDK lo rechaza).
    window.FB!.login(
      (response) => {
        const token = response.authResponse?.accessToken;
        if (!token) {
          setStatus("idle");
          return;
        }
        void completeConnection(token);
      },
      { config_id: configId },
    );
  }

  async function handleSelect() {
    setStatus("saving");
    const result = await selectMetaAdAccountAction(chosenId);
    setStatus("idle");
    if (result.error) {
      setError(result.error);
      return;
    }
    setChoices([]);
    router.refresh();
  }

  async function handleDisconnect() {
    setStatus("saving");
    await disconnectMetaAdsAction();
    setStatus("idle");
    setChoices([]);
    router.refresh();
  }

  const busy = status !== "idle";

  return (
    <div className="space-y-3">
      {choices.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">Elegí la cuenta publicitaria que querés usar:</p>
          <Select value={chosenId} onChange={(e) => setChosenId(e.target.value)} className="max-w-sm">
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.id})
              </option>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={handleSelect} disabled={busy}>
            {status === "saving" ? "Guardando…" : "Usar esta cuenta"}
          </Button>
        </div>
      )}

      {choices.length === 0 && connected && accountId && !needsReconnect && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-ink">
            Conectado: <span className="font-medium">{accountName ?? accountId}</span>{" "}
            <span className="font-mono text-xs text-ink-faint">{accountId}</span>
          </p>
          <Button type="button" variant="secondary" onClick={handleDisconnect} disabled={busy}>
            Desconectar
          </Button>
        </div>
      )}

      {needsReconnect && (
        <p className="text-sm text-danger">
          La conexión con Meta Ads venció o fue revocada. Volvé a conectar para seguir sincronizando el gasto.
        </p>
      )}

      {(!connected || needsReconnect) && choices.length === 0 && (
        <Button type="button" variant="secondary" onClick={handleConnect} disabled={busy}>
          <Megaphone size={16} />
          {status === "loading" && "Cargando…"}
          {status === "connecting" && "Conectando…"}
          {status !== "loading" && status !== "connecting" && (needsReconnect ? "Reconectar con Facebook" : "Conectar con Facebook")}
        </Button>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
