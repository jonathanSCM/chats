"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { setUserOrgRoleAction, removeUserFromOrgAction } from "@/server/actions/admin";

interface Membership {
  organizationId: string;
  organizationName: string;
  role: "OWNER" | "MEMBER";
}

export function UserOrgManager({
  userId,
  userEmail,
  memberships,
  organizations,
}: {
  userId: string;
  userEmail: string;
  memberships: Membership[];
  organizations: { id: string; name: string }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const available = organizations.filter((o) => !memberships.some((m) => m.organizationId === o.id));
  const [orgId, setOrgId] = useState("");
  const [role, setRole] = useState<"OWNER" | "MEMBER">("MEMBER");

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {memberships.length === 0 && <span className="text-xs text-ink-faint">Sin organización</span>}
        {memberships.map((m) => (
          <span
            key={m.organizationId}
            className="flex items-center gap-1 rounded-full border border-border bg-surface-2/60 py-0.5 pl-2.5 pr-1 text-xs"
          >
            {m.organizationName}
            <select
              value={m.role}
              disabled={pending}
              onChange={(e) =>
                run(() => setUserOrgRoleAction(userId, m.organizationId, e.target.value as "OWNER" | "MEMBER"))
              }
              className="cursor-pointer rounded bg-transparent font-mono text-[10px] uppercase text-accent"
              aria-label={`Rol de ${userEmail} en ${m.organizationName}`}
            >
              <option value="OWNER">Owner</option>
              <option value="MEMBER">Member</option>
            </select>
            <button
              type="button"
              disabled={pending}
              title="Sacar de esta organización"
              onClick={() => {
                if (confirm(`¿Sacar a ${userEmail} de ${m.organizationName}?`)) {
                  run(() => removeUserFromOrgAction(userId, m.organizationId));
                }
              }}
              className="cursor-pointer rounded-full p-0.5 text-ink-faint hover:text-danger"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>

      {available.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-44 py-1 text-xs">
            <option value="">Agregar a…</option>
            {available.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as "OWNER" | "MEMBER")}
            className="w-28 py-1 text-xs"
          >
            <option value="MEMBER">Member</option>
            <option value="OWNER">Owner</option>
          </Select>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !orgId}
            onClick={() => {
              run(() => setUserOrgRoleAction(userId, orgId, role));
              setOrgId("");
            }}
            className="px-3 py-1 text-xs"
          >
            Agregar
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
