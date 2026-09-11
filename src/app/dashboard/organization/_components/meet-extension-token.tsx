"use client";

import { useState, useTransition } from "react";
import { Copy, Check } from "lucide-react";
import { generateMeetExtensionTokenAction } from "@/server/actions/organization";
import { Button } from "@/components/ui/button";

// El token real solo se ve una vez, apenas se genera (igual que un API key
// de cualquier servicio) -- después queda enmascarado, porque el que se lee
// de la base no está pensado para volver a mostrarse en claro.
export function MeetExtensionToken({ hasToken }: { hasToken: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleGenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateMeetExtensionTokenAction();
      if (result.error) {
        setError(result.error);
        return;
      }
      setToken(result.token ?? null);
      setCopied(false);
    });
  }

  async function handleCopy() {
    if (!token) return;
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-3">
      {token ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-xs">
            <span className="flex-1 truncate">{token}</span>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 text-ink-faint hover:text-ink"
              title="Copiar"
            >
              {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Pégalo una sola vez en la configuración de la extensión — no se vuelve a mostrar
            completo después de recargar esta página.
          </p>
        </div>
      ) : hasToken ? (
        <p className="text-xs text-ink-faint">
          Ya hay un token generado (no se puede volver a mostrar). Si lo perdiste, generá uno
          nuevo — el anterior deja de funcionar.
        </p>
      ) : (
        <p className="text-xs text-ink-faint">
          Todavía no generaste un token para la extensión.
        </p>
      )}

      <Button type="button" variant="secondary" onClick={handleGenerate} disabled={isPending}>
        {isPending ? "Generando…" : hasToken ? "Regenerar token" : "Generar token"}
      </Button>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
