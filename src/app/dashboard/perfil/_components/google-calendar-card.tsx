"use client";

import { useTransition } from "react";
import { disconnectGoogleCalendarAction } from "@/server/actions/google-calendar-account";

export function GoogleCalendarCard({
  connectedEmail,
  notice,
}: {
  connectedEmail: string | null;
  notice: { type: "ok" | "error"; text: string } | null;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div>
      {notice && (
        <p className={`mb-3 text-sm ${notice.type === "ok" ? "text-accent" : "text-danger"}`}>{notice.text}</p>
      )}
      {connectedEmail ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-ink">Conectado como <strong>{connectedEmail}</strong></span>
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(async () => { await disconnectGoogleCalendarAction(); })}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
          >
            {isPending ? "Desconectando…" : "Desconectar"}
          </button>
        </div>
      ) : (
        <a
          href="/api/oauth/google-calendar/connect"
          className="inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:opacity-90"
        >
          Conectar mi Google Calendar
        </a>
      )}
    </div>
  );
}
