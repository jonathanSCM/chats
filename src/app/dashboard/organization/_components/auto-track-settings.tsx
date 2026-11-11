"use client";

import { useActionState } from "react";
import { updateAutoTrackLeadsAction } from "@/server/actions/organization";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function AutoTrackSettings({ enabled }: { enabled: boolean }) {
  const [state, formAction, isPending] = useActionState(updateAutoTrackLeadsAction, { error: null });
  const t = useT();

  return (
    <form action={formAction} className="space-y-4" key={String(enabled)}>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" name="autoTrackLeads" defaultChecked={enabled} className="mt-0.5 h-4 w-4" />
        <span>
          <b>{t("Dar seguimiento automático a cada chat nuevo")}</b>
          <span className="block text-xs text-ink-faint">
            {t("Cada cliente nuevo que escribe por WhatsApp recibe su tarjeta en Seguimiento y la IA la analiza sola unos minutos después de su último mensaje: calidad del lead, prioridad, dolor principal, qué falta saber y la siguiente pregunta. Se vuelve a analizar cuando el cliente sigue escribiendo. Cada análisis gasta créditos de IA; si se acaban, las tarjetas se crean igual pero sin análisis.")}
          </span>
        </span>
      </label>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}

      <Button type="submit" disabled={isPending}>
        {isPending ? t("Guardando…") : t("Guardar")}
      </Button>
    </form>
  );
}
