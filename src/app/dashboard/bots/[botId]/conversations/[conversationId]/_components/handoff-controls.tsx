"use client";

import { useActionState, useTransition } from "react";
import { UserRound, Bot } from "lucide-react";
import {
  setConversationPausedAction,
  sendManualMessageAction,
} from "@/server/actions/conversations";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/input";

export function HandoffControls({
  botId,
  conversationId,
  paused,
}: {
  botId: string;
  conversationId: string;
  paused: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const sendAction = sendManualMessageAction.bind(null, botId, conversationId);
  const [state, formAction, isSending] = useActionState(sendAction, { error: null });

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-between">
        {paused ? (
          <Badge tone="warning">
            <StatusDot tone="warning" /> Tomada por un humano
          </Badge>
        ) : (
          <Badge tone="accent">
            <StatusDot tone="accent" /> El bot responde solo
          </Badge>
        )}

        <Button
          variant="secondary"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await setConversationPausedAction(botId, conversationId, !paused);
            })
          }
        >
          {paused ? (
            <>
              <Bot size={14} /> Reanudar bot
            </>
          ) : (
            <>
              <UserRound size={14} /> Tomar conversación
            </>
          )}
        </Button>
      </div>

      {paused && (
        <form action={formAction} className="flex items-end gap-2">
          <Textarea
            name="content"
            placeholder="Responder como parte del equipo…"
            className="min-h-16 flex-1"
            required
          />
          <Button type="submit" disabled={isSending}>
            {isSending ? "Enviando…" : "Enviar"}
          </Button>
        </form>
      )}
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
    </div>
  );
}
