"use client";

import { useState, useTransition } from "react";
import { UserX } from "lucide-react";
import { removeMemberAction, changeMemberRoleAction, updateUserColorAction } from "@/server/actions/team";
import { Select } from "@/components/ui/input";
import { Table, Thead, Th, Td, Tr } from "@/components/ui/table";
import { vendorColor, VENDOR_COLOR_PALETTE } from "@/lib/vendor-color";

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: string;
  color: string | null;
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
  const [role, setRole] = useState(member.role);
  // Cambiar el rol es tan sensible como expulsar a alguien (le da o le
  // saca acceso de Admin) — se pide confirmación antes de aplicar, y el
  // select vuelve al valor real si falla o se cancela (antes era
  // `defaultValue`: no controlado, así que un error lo dejaba mostrando el
  // rol nuevo aunque no se hubiera guardado).
  const [pendingRole, setPendingRole] = useState<"OWNER" | "MEMBER" | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function confirmRoleChange() {
    if (!pendingRole) return;
    const next = pendingRole;
    setPendingRole(null);
    setRoleError(null);
    startTransition(async () => {
      const result = await changeMemberRoleAction(member.id, next);
      if (result.error) setRoleError(result.error);
      else setRole(next);
    });
  }

  function handleRemove() {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    setConfirmRemove(false);
    setRemoveError(null);
    startTransition(async () => {
      const result = await removeMemberAction(member.id);
      if (result.error) setRemoveError(result.error);
    });
  }

  return (
    <Tr>
      <Td>
        <span className="flex items-center gap-2">
          <ColorSwatch member={member} />
          {member.name ?? "—"}
        </span>
      </Td>
      <Td className="text-ink-muted">{member.email}</Td>
      <Td>
        {isSelf ? (
          <span className="text-sm text-ink-muted">{member.role === "OWNER" ? "Admin" : "Vendedor"}</span>
        ) : (
          <div className="space-y-1">
            <Select
              value={pendingRole ?? role}
              disabled={isPending}
              className="w-32 py-1.5 text-xs"
              onChange={(e) => setPendingRole(e.target.value as "OWNER" | "MEMBER")}
            >
              <option value="OWNER">Admin</option>
              <option value="MEMBER">Vendedor</option>
            </Select>
            {pendingRole && pendingRole !== role && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-ink-faint">¿Cambiar a {pendingRole === "OWNER" ? "Admin" : "Vendedor"}?</span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={confirmRoleChange}
                  className="cursor-pointer font-medium text-accent hover:opacity-80"
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setPendingRole(null)}
                  className="cursor-pointer text-ink-faint hover:text-ink"
                >
                  Cancelar
                </button>
              </div>
            )}
            {roleError && <p className="text-xs text-danger">{roleError}</p>}
          </div>
        )}
      </Td>
      <Td>
        {!isSelf && (
          <div className="space-y-1">
            <button
              type="button"
              disabled={isPending}
              onClick={handleRemove}
              className={`cursor-pointer transition-colors ${
                confirmRemove ? "text-danger" : "text-ink-faint hover:text-danger"
              }`}
              title={confirmRemove ? "¿Seguro? Toca de nuevo" : "Quitar del equipo"}
            >
              <UserX size={15} />
            </button>
            {removeError && <p className="text-xs text-danger">{removeError}</p>}
          </div>
        )}
      </Td>
    </Tr>
  );
}

// Punto de color con selector: un clic abre la paleta (más una opción de
// color libre) y otro clic elige. Sin esto, el color era fijo por hash del
// id — ahora cada quien puede fijar el suyo para reconocerse de un vistazo
// en la bandeja y en Seguimiento.
function ColorSwatch({ member }: { member: Member }) {
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const current = vendorColor(member.id, member.color);

  function pick(color: string) {
    setOpen(false);
    startTransition(async () => {
      await updateUserColorAction(member.id, color);
    });
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={isPending}
        onClick={() => setOpen((v) => !v)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-full ring-offset-2 ring-offset-surface transition-shadow hover:ring-2 hover:ring-border-strong"
        style={{ backgroundColor: current }}
        title="Cambiar color"
      />
      {open && (
        <>
          <button
            type="button"
            aria-label="Cerrar selector de color"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-6 z-20 flex w-[168px] flex-wrap gap-1.5 rounded-md border border-border bg-surface p-2.5 shadow-lg">
            {VENDOR_COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pick(c)}
                className="h-6 w-6 shrink-0 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  outline: c === current ? "2px solid var(--ink)" : "none",
                  outlineOffset: 2,
                }}
                title={c}
              />
            ))}
            <label
              className="relative flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-border-strong text-[10px] text-ink-faint hover:text-ink"
              title="Color personalizado"
            >
              +
              <input
                type="color"
                defaultValue={current}
                onChange={(e) => pick(e.target.value)}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
          </div>
        </>
      )}
    </span>
  );
}
