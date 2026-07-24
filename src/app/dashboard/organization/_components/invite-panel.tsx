"use client";

import { useActionState, useState, useTransition } from "react";
import { Copy, Check, X } from "lucide-react";
import { createInviteAction, revokeInviteAction } from "@/server/actions/team";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";

interface PendingInvite {
  id: string;
  email: string | null;
  expiresAt: string;
}

export function InvitePanel({ invites }: { invites: PendingInvite[] }) {
  const [state, formAction, isPending] = useActionState(createInviteAction, { error: null });
  const isInviteUrl = state.message?.startsWith("http");

  return (
    <div className="space-y-6">
      <form action={formAction} className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="email">Correo (opcional)</Label>
          <Input id="email" name="email" type="email" placeholder="persona@empresa.com" />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Generando…" : "Generar invitación"}
        </Button>
      </form>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {isInviteUrl && <CopyableLink url={state.message!} />}

      {invites.length > 0 && (
        <Table>
          <Thead>
            <tr>
              <Th>Invitación pendiente</Th>
              <Th>Vence</Th>
              <Th />
            </tr>
          </Thead>
          <tbody>
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function CopyableLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-md border border-accent-dim/50 bg-accent/10 px-3 py-2">
      <p className="flex-1 truncate font-mono text-xs text-ink">{url}</p>
      <button
        type="button"
        className="shrink-0 cursor-pointer text-accent hover:brightness-125"
        onClick={() => {
          navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

function InviteRow({ invite }: { invite: PendingInvite }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Tr>
      <Td>{invite.email ?? <span className="text-ink-faint">Enlace genérico</span>}</Td>
      <Td className="text-ink-muted">
        {new Date(invite.expiresAt).toLocaleDateString("es")}
      </Td>
      <Td>
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              await revokeInviteAction(invite.id);
            })
          }
          className="cursor-pointer text-ink-faint transition-colors hover:text-danger"
          title="Revocar invitación"
        >
          <X size={15} />
        </button>
      </Td>
    </Tr>
  );
}
