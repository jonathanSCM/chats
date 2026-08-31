"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Check, X, Bot as BotIcon } from "lucide-react";
import {
  renameBotAction,
  disconnectBotWhatsAppAction,
  setAiQualificationEnabledAction,
} from "@/server/actions/whatsapp-connection";
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
  bot: { id: string; name: string; aiQualificationEnabled: boolean };
  connection: Connection | null;
  isOwner: boolean;
  businessProfile: BusinessProfileData | null;
  businessProfileError?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(bot.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(bot.aiQualificationEnabled);
  const [isPending, startTransition] = useTransition();

  function toggleAi() {
    const next = !aiEnabled;
    setAiEnabled(next);
    startTransition(async () => {
      const result = await setAiQualificationEnabledAction(bot.id, next);
      if (result.error) setAiEnabled(!next);
    });
  }

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

      {isOwner && connection?.verified && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 p-3">
          <div className="flex gap-2">
            <BotIcon size={16} className="mt-0.5 shrink-0 text-ink-faint" />
            <div>
              <p className="text-sm font-medium text-ink">Bot de calificación por IA</p>
              <p className="text-xs text-ink-faint">
                Contesta solo los primeros mensajes de un lead nuevo (rubro, qué quiere mejorar,
                problema) y avisa al equipo cuando ya calificó. Se apaga solo apenas alguien del equipo
                responde a mano.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={toggleAi}
            className={`shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              aiEnabled ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-muted hover:text-ink"
            }`}
          >
            {aiEnabled ? "Activado" : "Apagado"}
          </button>
        </div>
      )}

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
