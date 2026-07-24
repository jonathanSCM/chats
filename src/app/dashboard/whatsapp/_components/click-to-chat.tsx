"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

export function ClickToChat({ displayNumber }: { displayNumber: string }) {
  const [message, setMessage] = useState("Hola, me interesa saber más 👋");
  const [copied, setCopied] = useState(false);

  const phone = digitsOnly(displayNumber);
  const link = `https://wa.me/${phone}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(link)}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="space-y-4">
      <div>
        <h3 className="font-display text-sm font-semibold text-ink">
          Link para que te escriban primero
        </h3>
        <p className="mt-1 text-xs text-ink-muted">
          Compártelo en tu web, bio de redes o anuncios — así ellos abren la conversación y
          puedes responderles libremente.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="prefill">Mensaje inicial (opcional)</Label>
        <Input
          id="prefill"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Hola, me interesa saber más"
        />
      </div>

      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <code className="flex-1 truncate text-xs text-ink-muted">{link}</code>
        <button
          onClick={handleCopy}
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {copied ? <Check size={14} className="text-accent" /> : <Copy size={14} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>

      <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qrUrl} alt="Código QR para iniciar el chat" width={180} height={180} />
        <p className="text-xs text-ink-faint">Escanéalo desde WhatsApp para abrir el chat</p>
      </div>
    </Card>
  );
}
