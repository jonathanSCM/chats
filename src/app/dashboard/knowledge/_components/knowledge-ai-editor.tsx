"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Send, History, Undo2, Check } from "lucide-react";
import {
  proposeKnowledgeChangesAction,
  applyKnowledgeChangesAction,
  revertKnowledgeChangeAction,
  type KnowledgeProposalResult,
} from "@/server/actions/knowledge";
import { diffLines, type ProposedChange } from "@/lib/knowledge-editor";
import { Card, CardTitle } from "@/components/ui/card";

export interface AiEditEntry {
  id: string;
  action: string;
  title: string;
  at: string;
  by: string | null;
  reason: string | null;
  reverted: boolean;
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  proposal?: KnowledgeProposalResult;
  applied?: boolean;
}

const ACTION_LABEL: Record<string, string> = {
  update: "Editar",
  create: "Nueva entrada",
  deactivate: "Desactivar",
  activate: "Activar",
};

const HISTORY_LABEL: Record<string, string> = {
  ai_edit_update: "Editó",
  ai_edit_create: "Creó",
  ai_edit_deactivate: "Desactivó",
  ai_edit_activate: "Activó",
  ai_edit_revert: "Revirtió",
};

const EXAMPLES = [
  "Quitá la pregunta del presupuesto de la guía de calificación, los leads abandonan cuando se las hacemos.",
  "Agregá una exclusión: no hacemos tiendas online.",
  "Hacé el tono más cercano y con frases más cortas.",
];

function ChangeDiff({ change }: { change: ProposedChange }) {
  if (change.action === "deactivate" || change.action === "activate") {
    return (
      <p className="text-xs text-ink-muted">
        {change.action === "deactivate"
          ? "La IA dejará de usar esta entrada (no se borra: se puede volver a activar)."
          : "La IA volverá a usar esta entrada."}
      </p>
    );
  }

  const lines =
    change.action === "create" || !change.before
      ? change.content.split("\n").map((text) => ({ type: "add" as const, text }))
      : diffLines(change.before.content, change.content);

  // Solo se muestran las líneas cambiadas con un poco de contexto.
  const shown = lines.filter((l, i) => {
    if (l.type !== "same") return true;
    return [lines[i - 1], lines[i + 1], lines[i - 2], lines[i + 2]].some((n) => n && n.type !== "same");
  });

  return (
    <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-surface-2/40 p-2 text-xs leading-relaxed">
      {shown.map((l, i) => (
        <div
          key={i}
          className={
            l.type === "add"
              ? "whitespace-pre-wrap bg-accent-dim/20 text-accent"
              : l.type === "del"
                ? "whitespace-pre-wrap bg-danger-dim text-danger line-through"
                : "whitespace-pre-wrap text-ink-faint"
          }
        >
          {l.type === "add" ? "+ " : l.type === "del" ? "- " : "  "}
          {l.text || " "}
        </div>
      ))}
    </div>
  );
}

export function KnowledgeAiEditor({ history }: { history: AiEditEntry[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [showHistory, setShowHistory] = useState(false);

  const lastIdx = turns.length - 1;
  const last = lastIdx >= 0 ? turns[lastIdx] : null;
  const actionable = last?.role === "assistant" && last.proposal && last.proposal.changes.length > 0 && !last.applied;

  function send(text: string) {
    const instruction = text.trim();
    if (instruction.length < 3 || pending) return;
    setError(null);
    const prior = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: "user", text: instruction }]);
    setInput("");

    startTransition(async () => {
      const result = await proposeKnowledgeChangesAction(instruction, prior);
      if (result.error) {
        setError(result.error);
        return;
      }
      const text = [result.message, result.clarification].filter(Boolean).join("\n\n");
      setTurns((t) => [...t, { role: "assistant", text: text || "No encontré cambios para hacer.", proposal: result }]);
      setSelected(new Set(result.changes.map((_, i) => i)));
    });
  }

  function apply() {
    if (!last?.proposal) return;
    const chosen = last.proposal.changes.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    setError(null);
    startTransition(async () => {
      // `before` es solo para mostrar: el servidor recalcula el estado anterior desde la base.
      const result = await applyKnowledgeChangesAction(
        chosen.map((c) => ({
          action: c.action,
          itemId: c.itemId,
          category: c.category,
          title: c.title,
          content: c.content,
          reason: c.reason,
          baseVersion: c.baseVersion,
        })),
      );
      if (result.error) {
        setError(result.error);
        return;
      }
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, applied: true } : turn)));
      router.refresh();
    });
  }

  function discard() {
    setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, proposal: { ...turn.proposal!, changes: [] } } : turn)));
  }

  function revert(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await revertKnowledgeChangeAction(id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <Card className="mb-6 border-accent-dim/40">
      <div className="mb-3 flex items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles size={15} className="text-accent" /> Editar con IA
        </CardTitle>
        {history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-ink-muted hover:text-accent"
          >
            <History size={12} /> Cambios hechos con IA ({history.length})
          </button>
        )}
      </div>

      <p className="mb-3 text-xs text-ink-muted">
        Pedí el cambio como se lo dirías a un colega. La IA propone la edición, la ves marcada y vos la aprobás:
        nada se aplica solo, y todo se puede revertir.
      </p>

      {turns.length === 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={pending}
              onClick={() => send(ex)}
              className="rounded-full border border-border px-2.5 py-1 text-left text-xs text-ink-muted transition-colors hover:border-accent-dim hover:text-accent"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="mb-3 max-h-[28rem] space-y-3 overflow-y-auto">
          {turns.map((t, ti) => (
            <div key={ti} className={t.role === "user" ? "flex justify-end" : ""}>
              <div
                className={
                  t.role === "user"
                    ? "max-w-[85%] rounded-lg bg-accent-dim/20 px-3 py-2 text-sm text-ink"
                    : "w-full space-y-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-sm text-ink"
                }
              >
                <p className="whitespace-pre-wrap">{t.text}</p>

                {t.proposal && t.proposal.changes.length > 0 && (
                  <div className="space-y-3 pt-1">
                    {t.proposal.changes.map((c, ci) => (
                      <div key={ci} className="space-y-1.5 rounded-md border border-border p-2.5">
                        <label className="flex cursor-pointer items-start gap-2">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            disabled={t.applied || ti !== lastIdx}
                            checked={t.applied ? true : selected.has(ci)}
                            onChange={() =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (next.has(ci)) next.delete(ci);
                                else next.add(ci);
                                return next;
                              })
                            }
                          />
                          <span className="min-w-0 text-xs">
                            <span className="mr-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-ink-faint">
                              {ACTION_LABEL[c.action]}
                            </span>
                            <span className="font-medium text-ink">{c.before?.title ?? c.title}</span>
                            {c.reason && <span className="mt-0.5 block text-ink-muted">{c.reason}</span>}
                          </span>
                        </label>
                        <ChangeDiff change={c} />
                      </div>
                    ))}

                    {t.proposal.dropped.length > 0 && (
                      <p className="text-xs text-ink-faint">
                        No se propuso: {t.proposal.dropped.join("; ")}.
                      </p>
                    )}

                    {t.applied && (
                      <p className="flex items-center gap-1.5 text-xs text-accent">
                        <Check size={12} /> Aplicado.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {actionable && (
        <div className="mb-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || selected.size === 0}
            onClick={apply}
            className="rounded-full border border-accent-dim/40 bg-accent-dim/10 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent-dim/20 disabled:opacity-50"
          >
            {pending ? "Aplicando…" : `Aplicar ${selected.size} cambio${selected.size === 1 ? "" : "s"}`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={discard}
            className="rounded-full border border-border px-3 py-1.5 text-xs text-ink-muted hover:text-ink"
          >
            Descartar
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          maxLength={2000}
          placeholder={
            turns.length === 0
              ? "Ej.: Quitá esta pregunta de la guía porque los leads abandonan…"
              : "Pedí otro cambio o aclará lo anterior…"
          }
          className="min-h-[2.75rem] flex-1 resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent-dim focus:outline-none"
          disabled={pending}
        />
        <button
          type="submit"
          disabled={pending || input.trim().length < 3}
          className="flex h-[2.75rem] items-center gap-1.5 rounded-md border border-accent-dim/40 bg-accent-dim/10 px-3 text-xs text-accent transition-colors hover:bg-accent-dim/20 disabled:opacity-50"
        >
          <Send size={13} /> {pending ? "Pensando…" : "Enviar"}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {showHistory && (
        <ul className="mt-4 space-y-1.5 border-t border-border pt-3">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-xs text-ink-faint">
                {HISTORY_LABEL[h.action] ?? h.action}
              </span>
              <span className="min-w-0 flex-1 truncate text-ink" title={h.reason ?? undefined}>
                {h.title}
              </span>
              <span className="text-ink-faint">
                {new Date(h.at).toLocaleString("es")}
                {h.by ? ` · ${h.by}` : ""}
              </span>
              {h.action !== "ai_edit_revert" &&
                (h.reverted ? (
                  <span className="text-ink-faint">revertido</span>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => revert(h.id)}
                    className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-ink-muted hover:border-accent-dim hover:text-accent"
                  >
                    <Undo2 size={10} /> Revertir
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
