"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Check, X, Bot as BotIcon } from "lucide-react";
import {
  renameBotAction,
  disconnectBotWhatsAppAction,
  setAiQualificationEnabledAction,
  setAiTestPhoneAction,
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
  bot: { id: string; name: string; aiQualificationEnabled: boolean; aiTestPhone: string | null };
  connection: Connection | null;
  isOwner: boolean;
  businessProfile: BusinessProfileData | null;
  businessProfileError?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(bot.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(bot.aiQualificationEnabled);
  const [testPhone, setTestPhone] = useState(bot.aiTestPhone ?? "");
  const [testPhoneSaved, setTestPhoneSaved] = useState(bot.aiTestPhone ?? "");
  const [testPhoneError, setTestPhoneError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Activar sin teléfono de prueba cargado contesta leads reales de
  // inmediato — se pide un toque más para confirmar ese caso puntual.
  const [confirmActivate, setConfirmActivate] = useState(false);

  function toggleAi() {
    if (!aiEnabled && !testPhoneSaved && !confirmActivate) {
      setConfirmActivate(true);
      setTimeout(() => setConfirmActivate(false), 4000);
      return;
    }
    setConfirmActivate(false);
    const next = !aiEnabled;
    setAiEnabled(next);
    startTransition(async () => {
      const result = await setAiQualificationEnabledAction(bot.id, next);
      if (result.error) setAiEnabled(!next);
    });
  }

  function saveTestPhone() {
    setTestPhoneError(null);
    startTransition(async () => {
      const result = await setAiTestPhoneAction(bot.id, testPhone.trim());
      if (result.error) setTestPhoneError(result.error);
      else setTestPhoneSaved(testPhone.trim());
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
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              disabled={isPending}
              onClick={toggleAi}
              title={
                confirmActivate
                  ? "Sin teléfono de prueba, va a contestarle a TODOS los leads nuevos"
                  : undefined
              }
              className={`cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                confirmActivate
                  ? "bg-warning text-accent-ink"
                  : aiEnabled
                    ? "bg-accent text-accent-ink"
                    : "bg-surface-2 text-ink-muted hover:text-ink"
              }`}
            >
              {confirmActivate ? "¿Seguro? Toca de nuevo" : aiEnabled ? "Activado" : "Apagado"}
            </button>
            {confirmActivate && (
              <p className="max-w-[12rem] text-right text-[10px] text-warning">
                Sin teléfono de prueba, contesta a todos los leads nuevos ya mismo.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Visible aunque el bot esté apagado: así se puede cargar el
          teléfono de prueba ANTES de activarlo, en vez de que el único
          momento en que se ve esta advertencia sea después de haber
          prendido el bot para todo el mundo. */}
      {isOwner && connection?.verified && (
        <div className="space-y-1.5 rounded-md border border-border/60 p-3">
          <p className="text-sm font-medium text-ink">Modo de prueba</p>
          <p className="text-xs text-ink-faint">
            Con un teléfono cargado acá, el bot SOLO le contesta a ese número — todos los demás leads
            siguen siendo 100% manuales aunque el bot esté activado. Dejalo vacío para que responda a
            todo el mundo.
          </p>
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Ej. 59178795415 (sin +)"
              className="py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={isPending || testPhone.trim() === testPhoneSaved}
              onClick={saveTestPhone}
              className="shrink-0 cursor-pointer rounded-md bg-surface-2 px-3 py-1.5 text-xs font-medium text-ink-muted hover:text-ink disabled:opacity-50"
            >
              Guardar
            </button>
          </div>
          {testPhoneError && <p className="text-xs text-danger">{testPhoneError}</p>}
          {!testPhoneError && testPhoneSaved && (
            <p className="text-xs text-accent">Modo de prueba activo — solo contesta a {testPhoneSaved}.</p>
          )}
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
