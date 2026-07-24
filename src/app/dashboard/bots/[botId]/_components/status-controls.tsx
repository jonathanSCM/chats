"use client";

import { useState, useTransition } from "react";
import { Play, Pause } from "lucide-react";
import { setBotStatusAction } from "@/server/actions/bots";
import { Button } from "@/components/ui/button";
import type { BotStatus } from "@/generated/prisma/enums";

export function StatusControls({ botId, status }: { botId: string; status: BotStatus }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(next: "ACTIVE" | "PAUSED") {
    setError(null);
    startTransition(async () => {
      const result = await setBotStatusAction(botId, next);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {status === "ACTIVE" ? (
        <Button variant="secondary" size="sm" disabled={isPending} onClick={() => handleChange("PAUSED")}>
          <Pause size={14} /> Pausar
        </Button>
      ) : (
        <Button size="sm" disabled={isPending} onClick={() => handleChange("ACTIVE")}>
          <Play size={14} /> Activar
        </Button>
      )}
      {error && <p className="max-w-56 text-right text-xs text-danger">{error}</p>}
    </div>
  );
}
