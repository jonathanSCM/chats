"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { renameBotAction, disconnectBotWhatsAppAction } from "@/server/actions/whatsapp-connection";
import { Input } from "@/components/ui/input";
import { WhatsAppTab } from "./whatsapp-tab";
import { BusinessProfileForm, type BusinessProfileData } from "./business-profile-form";
import { TemplateManager } from "./template-manager";

interface Connection {
  phoneNumberId: string;
  wabaId: string | null;
  verified: boolean;
  displayNumber?: string | null;
  coexistence?: boolean;
  historySyncStatus?: "NONE" | "PENDING" | "COMPLETE";
}

export function BotAccountCard({
  bot,
  connection,
  isOwner,
  businessProfile,
  businessProfileError,
}: {
  bot: { id: string; name: string };
  connection: Connection | null;
  isOwner: boolean;
  businessProfile: BusinessProfileData | null;
  businessProfileError?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(bot.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === bot.name) {
      setEditing(false);
      setName(bot.name);
      return;
    }
    startTransition(async () => {
      await renameBotAction(bot.id, trimmed);
      setEditing(false);
    });
  }

  return (
    <div className="space-y-4 rounded-lg border border-border/60 p-4">
      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="py-1.5 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setEditing(false);
                  setName(bot.name);
                }
              }}
            />
            <button
              type="button"
              onClick={saveName}
              disabled={isPending}
              className="cursor-pointer text-accent hover:opacity-80"
              title="Guardar"
            >
              <Check size={16} />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(bot.name);
              }}
              className="cursor-pointer text-ink-faint hover:text-ink"
              title="Cancelar"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <h3 className="font-display text-sm font-semibold text-ink">{bot.name}</h3>
            {isOwner && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="cursor-pointer text-ink-faint hover:text-ink"
                title="Renombrar cuenta"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        )}

        {isOwner && connection?.verified && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 3000);
                return;
              }
              startTransition(async () => {
                await disconnectBotWhatsAppAction(bot.id);
                setConfirmDelete(false);
              });
            }}
            className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-ink-faint hover:text-danger"
          >
            <Trash2 size={13} />
            {confirmDelete ? "¿Seguro? Toca de nuevo" : "Desconectar"}
          </button>
        )}
      </div>

      <WhatsAppTab botId={bot.id} connection={connection} readOnly={!isOwner} />

      {businessProfile && (
        <div className="pt-2">
          <BusinessProfileForm botId={bot.id} profile={businessProfile} />
        </div>
      )}
      {businessProfileError && (
        <p className="text-sm text-warning">No se pudo cargar el perfil de negocio desde Meta.</p>
      )}

      {isOwner && connection?.verified && (
        <div className="pt-2">
          <TemplateManager botId={bot.id} />
        </div>
      )}
    </div>
  );
}
