"use client";

import { useTransition } from "react";
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
      onClick={(e) => e.stopPropagation()}
      className="w-full cursor-pointer truncate border-none bg-transparent p-0 font-mono text-[11px] text-ink-faint outline-none disabled:opacity-50"
      title="Cambiar de organización"
    >
      {memberships.map((m) => (
        <option key={m.organizationId} value={m.organizationId}>
          {m.organizationName}
        </option>
      ))}
    </select>
  );
}
