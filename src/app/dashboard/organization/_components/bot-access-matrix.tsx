"use client";

import { useState, useTransition } from "react";
import { toggleBotAccessAction } from "@/server/actions/whatsapp-connection";
import { vendorColor } from "@/lib/vendor-color";

interface Bot {
  id: string;
  name: string;
}

interface Member {
  id: string;
  name: string;
  email: string;
  color: string | null;
}

export function BotAccessMatrix({
  bots,
  members,
  initialAccess,
}: {
  bots: Bot[];
  members: Member[];
  /** Set de claves "botId:userId" que ya tienen acceso. */
  initialAccess: Set<string>;
}) {
  const [access, setAccess] = useState(initialAccess);
  const [isPending, startTransition] = useTransition();

  function toggle(botId: string, userId: string, granted: boolean) {
    const key = `${botId}:${userId}`;
    setAccess((prev) => {
      const next = new Set(prev);
      if (granted) next.add(key);
      else next.delete(key);
      return next;
    });
    startTransition(async () => {
      await toggleBotAccessAction(botId, userId, granted);
    });
  }

  if (members.length === 0) {
    return (
      <p className="text-sm text-ink-muted">Invita vendedores al equipo para poder asignarles cuentas.</p>
    );
  }
  if (bots.length === 0) {
    return <p className="text-sm text-ink-muted">Todavía no hay cuentas de WhatsApp conectadas.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 border-b border-border bg-surface px-2 py-2 text-left font-mono text-[11px] uppercase tracking-wide text-ink-muted">
              Vendedor
            </th>
            {bots.map((bot) => (
              <th
                key={bot.id}
                className="whitespace-nowrap border-b border-border px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wide text-ink-muted"
              >
                {bot.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.id}>
              <td className="sticky left-0 whitespace-nowrap border-b border-border/50 bg-surface px-2 py-2.5">
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: vendorColor(member.id, member.color) }}
                  />
                  {member.name || member.email}
                </span>
              </td>
              {bots.map((bot) => {
                const key = `${bot.id}:${member.id}`;
                const checked = access.has(key);
                return (
                  <td key={bot.id} className="border-b border-border/50 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isPending}
                      onChange={(e) => toggle(bot.id, member.id, e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-accent"
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
