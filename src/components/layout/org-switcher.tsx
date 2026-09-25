"use client";

import { useState, useTransition } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { switchOrganizationAction } from "@/server/actions/organization-switch";

export function OrgSwitcher({
  currentOrganizationId,
  memberships,
}: {
  currentOrganizationId: string;
  memberships: { organizationId: string; organizationName: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const current = memberships.find((m) => m.organizationId === currentOrganizationId);

  function pick(organizationId: string) {
    setOpen(false);
    if (organizationId === currentOrganizationId) return;
    startTransition(async () => {
      const result = await switchOrganizationAction(organizationId);
      // Recarga real del navegador, no navegación de Next -- ver el
      // comentario en organization-switch.ts sobre por qué hace falta.
      if (!result.error) window.location.assign("/dashboard");
    });
  }

  return (
    <div className="relative w-full">
      <button
        type="button"
        disabled={isPending}
        onClick={() => setOpen((v) => !v)}
        title="Cambiar de organización"
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2/60 hover:text-ink disabled:opacity-50"
      >
        <Building2 size={16} className="shrink-0" />
        <span className="flex-1 truncate text-left">{current?.organizationName ?? "Sin organización"}</span>
        <ChevronDown size={14} className="shrink-0" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar selector de organización"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-md border border-border bg-surface shadow-lg">
            {memberships.map((m) => (
              <button
                key={m.organizationId}
                type="button"
                onClick={() => pick(m.organizationId)}
                className="flex w-full items-center gap-2 truncate px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-surface-2/60"
              >
                <Check
                  size={13}
                  className={`shrink-0 ${m.organizationId === currentOrganizationId ? "text-accent" : "text-transparent"}`}
                />
                <span className="truncate">{m.organizationName}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
