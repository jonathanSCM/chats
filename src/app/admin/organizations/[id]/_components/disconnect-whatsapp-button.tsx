"use client";

import { useState, useTransition } from "react";
import { Unplug } from "lucide-react";
import { disconnectWhatsAppAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";

export function DisconnectWhatsAppButton({ botId }: { botId: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState(false);

  return (
    <Button
      variant="danger"
      size="sm"
      disabled={isPending}
      onClick={() => {
        if (!confirm) {
          setConfirm(true);
          setTimeout(() => setConfirm(false), 3000);
          return;
        }
        startTransition(async () => {
          await disconnectWhatsAppAction(botId);
        });
      }}
    >
      <Unplug size={14} />
      {confirm ? "¿Seguro? Toca de nuevo" : "Desconectar"}
    </Button>
  );
}
