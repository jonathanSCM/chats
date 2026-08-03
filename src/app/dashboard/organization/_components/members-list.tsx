"use client";

import { useTransition } from "react";
import { UserX } from "lucide-react";
import { removeMemberAction } from "@/server/actions/team";
import { Badge } from "@/components/ui/badge";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { vendorColor } from "@/lib/vendor-color";

const roleLabel: Record<string, string> = {
  SUPERADMIN: "Superadmin",
  OWNER: "Admin",
  MEMBER: "Vendedor",
};

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
        <Badge tone={member.role === "OWNER" ? "accent" : "neutral"}>
          {roleLabel[member.role] ?? member.role}
        </Badge>
      </Td>
      <Td>
        {!isSelf && member.role !== "OWNER" && (
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
