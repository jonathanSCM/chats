"use client";

import { useActionState, useState, useTransition } from "react";
import { setMemberAvailabilityAction, updateAutoAssignSettingsAction } from "@/server/actions/organization";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: "OWNER" | "MEMBER" | string;
  availableForLeads: boolean;
}

export function AutoAssignSettings({
  enabled,
  slaMinutes,
  maxOpen,
  members,
}: {
  enabled: boolean;
  slaMinutes: number;
  maxOpen: number | null;
  members: Member[];
}) {
  const [state, formAction, isPending] = useActionState(updateAutoAssignSettingsAction, { error: null });
  const [available, setAvailable] = useState<Record<string, boolean>>(
    Object.fromEntries(members.map((m) => [m.id, m.availableForLeads])),
  );
  const [memberError, setMemberError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle(userId: string, next: boolean) {
    setAvailable((prev) => ({ ...prev, [userId]: next }));
    setMemberError(null);
    startTransition(async () => {
      const result = await setMemberAvailabilityAction(userId, next);
      if (result.error) {
        setAvailable((prev) => ({ ...prev, [userId]: !next })); // se deshace si falló
        setMemberError(result.error);
      }
    });
  }

  const eligible = members.filter((m) => available[m.id]).length;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>¿Quién recibe leads?</Label>
        <p className="text-xs text-ink-faint">
          Marca a quienes entran al reparto por turnos. Los administradores vienen desmarcados; actívalos si
          también venden.
        </p>
        <ul className="divide-y divide-border rounded-control border border-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 text-sm text-ink">
                <span className="block truncate">{m.name || m.email}</span>
                <span className="block text-xs text-ink-faint">{m.role === "OWNER" ? "Admin" : "Vendedor"}</span>
              </span>
              <label className="flex shrink-0 items-center gap-2 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={available[m.id] ?? false}
                  onChange={(e) => toggle(m.id, e.target.checked)}
                />
                Disponible
              </label>
            </li>
          ))}
        </ul>
        {memberError && <p className="text-sm text-danger">{memberError}</p>}
      </div>

      <form action={formAction} className="space-y-4" key={`${enabled}-${slaMinutes}-${maxOpen}`}>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="autoAssignEnabled" defaultChecked={enabled} className="mt-0.5 h-4 w-4" />
          <span>
            <b>Asignar los leads nuevos automáticamente</b>
            <span className="block text-xs text-ink-faint">
              Cuando el bot califica un lead (o llega un chat sin bot) se asigna por turnos a quien esté
              disponible. Si alguien lo asigna a mano, el sistema no lo cambia. Disponibles ahora: {eligible}.
            </span>
          </span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="autoAssignSlaMinutes">Avisar si el cliente espera más de (minutos)</Label>
            <Input
              id="autoAssignSlaMinutes"
              name="autoAssignSlaMinutes"
              type="number"
              min={1}
              max={240}
              defaultValue={slaMinutes}
            />
            <p className="text-xs text-ink-faint">
              Se avisa al vendedor y a los administradores. Si pasa el doble de ese tiempo sin respuesta, el
              lead pasa al siguiente (una sola vez).
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="autoAssignMaxOpen">Tope de leads abiertos por vendedor</Label>
            <Input
              id="autoAssignMaxOpen"
              name="autoAssignMaxOpen"
              type="number"
              min={1}
              max={500}
              defaultValue={maxOpen ?? ""}
              placeholder="Sin tope"
            />
            <p className="text-xs text-ink-faint">Quien llega al tope se saltea en el reparto. Vacío = sin tope.</p>
          </div>
        </div>

        {state.error && <p className="text-sm text-danger">{state.error}</p>}
        {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}

        <Button type="submit" disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
      </form>
    </div>
  );
}
