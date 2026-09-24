"use client";

import { useTransition } from "react";
import { Building2 } from "lucide-react";
import { switchOrganizationAction } from "@/server/actions/organization-switch";

export function OrgSwitcher({
  currentOrganizationId,
  memberships,
}: {
  currentOrganizationId: string;
  memberships: { organizationId: string; organizationName: string }[];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="relative flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-2/60 hover:text-ink">
      <Building2 size={16} className="shrink-0" />
      <select
        value={currentOrganizationId}
        disabled={isPending}
        onChange={(e) => {
          const organizationId = e.target.value;
          if (organizationId === currentOrganizationId) return;
          startTransition(() => {
            switchOrganizationAction(organizationId);
          });
        }}
        className="w-full cursor-pointer truncate border-none bg-transparent p-0 text-sm text-inherit outline-none disabled:opacity-50"
        title="Cambiar de organización"
      >
        {memberships.map((m) => (
          <option key={m.organizationId} value={m.organizationId}>
            {m.organizationName}
          </option>
        ))}
      </select>
    </div>
  );
}
