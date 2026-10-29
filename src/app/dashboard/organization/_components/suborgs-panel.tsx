"use client";

import { useActionState, useState, useTransition } from "react";
import { createSubOrganizationAction, setSubOrgSellersAction } from "@/server/actions/suborganizations";
import { Input, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Seller {
  id: string;
  name: string | null;
  email: string;
}

interface SubOrg {
  id: string;
  name: string;
  sellerIds: string[];
}

function SellerChecklist({
  sellers,
  checked,
  onToggle,
  name,
}: {
  sellers: Seller[];
  checked: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  name?: string;
}) {
  if (sellers.length === 0) {
    return <p className="text-xs text-ink-faint">Todavía no tienes vendedores. Invítalos desde la pestaña Equipo.</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-control border border-border">
      {sellers.map((s) => (
        <li key={s.id} className="px-3 py-2">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name={name}
              value={s.id}
              checked={checked.has(s.id)}
              onChange={(e) => onToggle(s.id, e.target.checked)}
              className="h-4 w-4"
            />
            <span className="min-w-0 truncate">{s.name || s.email}</span>
            {s.name && <span className="truncate text-xs text-ink-faint">{s.email}</span>}
          </label>
        </li>
      ))}
    </ul>
  );
}

function CreateForm({ sellers }: { sellers: Seller[] }) {
  const [state, formAction, isPending] = useActionState(createSubOrganizationAction, { error: null });
  const [checked, setChecked] = useState<Set<string>>(new Set());

  function toggle(id: string, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="subOrgName">Nombre de la suborganización</Label>
        <Input id="subOrgName" name="name" required minLength={2} maxLength={120} placeholder="Ej. Sucursal Arequipa" />
      </div>
      <div className="space-y-1.5">
        <Label>Vendedores que la usarán</Label>
        <SellerChecklist sellers={sellers} checked={checked} onToggle={toggle} name="sellerIds" />
        <p className="text-xs text-ink-faint">
          Los administradores de tu organización entran a todas las suborganizaciones automáticamente. Los
          vendedores no ocupan un lugar nuevo de tu plan.
        </p>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      {state.message && !isPending && <p className="text-sm text-accent">{state.message}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Creando…" : "Crear suborganización"}
      </Button>
    </form>
  );
}

function SubOrgRow({ subOrg, sellers }: { subOrg: SubOrg; sellers: Seller[] }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(subOrg.sellerIds));
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty =
    checked.size !== subOrg.sellerIds.length || subOrg.sellerIds.some((id) => !checked.has(id));

  function toggle(id: string, on: boolean) {
    setMessage(null);
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function save() {
    startTransition(async () => {
      const r = await setSubOrgSellersAction(subOrg.id, [...checked]);
      setMessage(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "Guardado." });
    });
  }

  return (
    <li className="space-y-3 rounded-control border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium text-ink">{subOrg.name}</p>
        <span className="shrink-0 text-xs text-ink-faint">
          {checked.size} vendedor{checked.size === 1 ? "" : "es"}
        </span>
      </div>
      <SellerChecklist sellers={sellers} checked={checked} onToggle={toggle} />
      <div className="flex items-center gap-3">
        <Button type="button" size="sm" disabled={!dirty || isPending} onClick={save}>
          {isPending ? "Guardando…" : "Guardar vendedores"}
        </Button>
        {message && <p className={`text-xs ${message.ok ? "text-accent" : "text-danger"}`}>{message.text}</p>}
      </div>
    </li>
  );
}

export function SubOrgsPanel({
  subOrgs,
  sellers,
  maxSubOrgs,
}: {
  subOrgs: SubOrg[];
  sellers: Seller[];
  maxSubOrgs: number | null;
}) {
  const full = maxSubOrgs !== null && subOrgs.length >= maxSubOrgs;

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-faint">
        Suborganizaciones: {subOrgs.length} {maxSubOrgs === null ? "(sin límite)" : `de ${maxSubOrgs}`}
      </p>

      {subOrgs.length === 0 ? (
        <p className="text-sm text-ink-muted">Todavía no tienes suborganizaciones.</p>
      ) : (
        <ul className="space-y-3">
          {subOrgs.map((s) => (
            <SubOrgRow key={s.id} subOrg={s} sellers={sellers} />
          ))}
        </ul>
      )}

      {full ? (
        <p className="rounded-control border border-border px-3 py-2 text-sm text-ink-muted">
          Llegaste al máximo de suborganizaciones de tu plan.
        </p>
      ) : (
        <div className="border-t border-border pt-5">
          <h3 className="mb-3 text-sm font-semibold text-ink">Nueva suborganización</h3>
          <CreateForm sellers={sellers} />
        </div>
      )}
    </div>
  );
}
