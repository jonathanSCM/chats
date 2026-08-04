"use client";

import { useTransition } from "react";
import { UserX } from "lucide-react";
import { removeMemberAction, changeMemberRoleAction } from "@/server/actions/team";
import { Select } from "@/components/ui/input";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { vendorColor } from "@/lib/vendor-color";

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

export function MembersList({
  members,
  currentUserId,
}: {
  members: Member[];
  currentUserId: string;
}) {
  return (
    <Table>
      <Thead>
        <tr>
          <Th>Nombre</Th>
          <Th>Correo</Th>
          <Th>Rol</Th>
          <Th />
        </tr>
      </Thead>
      <tbody>
        {members.map((member) => (
          <MemberRow key={member.id} member={member} isSelf={member.id === currentUserId} />
        ))}
      </tbody>
    </Table>
  );
}

function MemberRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: vendorColor(member.id) }}
          />
          {member.name ?? "—"}
        </span>
      </Td>
      <Td className="text-ink-muted">{member.email}</Td>
      <Td>
        {isSelf ? (
          <span className="text-sm text-ink-muted">{member.role === "OWNER" ? "Admin" : "Vendedor"}</span>
        ) : (
          <Select
            defaultValue={member.role}
            disabled={isPending}
            className="w-32 py-1.5 text-xs"
            onChange={(e) => {
              const role = e.target.value as "OWNER" | "MEMBER";
              startTransition(async () => {
                await changeMemberRoleAction(member.id, role);
              });
            }}
          >
            <option value="OWNER">Admin</option>
            <option value="MEMBER">Vendedor</option>
          </Select>
        )}
      </Td>
      <Td>
        {!isSelf && (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await removeMemberAction(member.id);
              })
            }
            className="cursor-pointer text-ink-faint transition-colors hover:text-danger"
            title="Quitar del equipo"
          >
            <UserX size={15} />
          </button>
        )}
      </Td>
    </Tr>
  );
}
