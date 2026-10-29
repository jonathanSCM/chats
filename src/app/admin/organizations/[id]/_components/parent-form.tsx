"use client";

import { useActionState, useState } from "react";
import { setOrgParentAction } from "@/server/actions/admin-hierarchy";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";

export function ParentForm({
  orgId,
  currentParentId,
  currentParentName,
  eligibleParents,
  hasChildren,
  parentUsersInOrg,
}: {
  orgId: string;
  currentParentId: string | null;
  currentParentName: string | null;
  eligibleParents: { id: string; name: string }[];
  hasChildren: boolean;
  parentUsersInOrg: number;
}) {
  const [state, formAction, isPending] = useActionState(setOrgParentAction.bind(null, orgId), { error: null });
  const [selected, setSelected] = useState(currentParentId ?? "");
  const detaching = Boolean(currentParentId) && selected === "";

  if (hasChildren) {
    return (
      <p className="text-sm text-ink-muted">
        Esta organización ya tiene suborganizaciones propias, así que no puede ser hija de otra (solo hay un nivel).
        Desvincula primero sus suborganizaciones.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4" key={currentParentId ?? "sin-padre"}>
      <div className="space-y-1.5">
        <Label htmlFor="parentId">Organización principal</Label>
        <select
          id="parentId"
          name="parentId"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full max-w-sm rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink"
        >
          <option value="">Ninguna (organización independiente)</option>
          {currentParentId && !eligibleParents.some((p) => p.id === currentParentId) && (
            <option value={currentParentId}>{currentParentName}</option>
          )}
          {eligibleParents.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {eligibleParents.length === 0 && !currentParentId && (
          <p className="text-xs text-ink-faint">
            No hay organizaciones con suborganizaciones habilitadas. Actívalas en el plan de la que quieras que sea la
            principal.
          </p>
        )}
      </div>

      {!detaching && selected && selected !== currentParentId && (
        <p className="rounded-control border border-border px-3 py-2 text-xs text-ink-muted">
          Al unirla: sus administradores y vendedores pasan a contar en el plan de usuarios de la principal, los
          administradores de la principal entran como administradores a esta, y hereda su marca y su clave de IA (a
          menos que tenga las suyas). Sus chats, contactos y WhatsApp siguen siendo suyos y separados.
        </p>
      )}

      {detaching && (
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" name="removeParentUsers" defaultChecked className="mt-0.5 h-4 w-4" />
          <span>
            <b>Quitar el acceso de las personas de la organización principal</b>
            <span className="block text-xs text-ink-faint">
              {parentUsersInOrg} persona{parentUsersInOrg === 1 ? "" : "s"} de {currentParentName} tiene{parentUsersInOrg === 1 ? "" : "n"} hoy acceso a
              esta organización. Si desmarcas, conservan el acceso aunque deje de ser su hija.
            </span>
          </span>
        </label>
      )}

      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending || (selected === (currentParentId ?? ""))}>
        {isPending ? "Guardando…" : detaching ? "Desvincular" : "Guardar"}
      </Button>
    </form>
  );
}
