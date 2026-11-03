"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { SidePanel } from "@/components/side-panel";
import { Button } from "@/components/ui/button";
import { KnowledgeAiEditor, type AiEditEntry } from "./knowledge-ai-editor";

/**
 * Botón "Editar con IA": abre el editor en una ventana lateral. Una vez abierta se queda montada (solo oculta)
 * para no perder la conversación ni una propuesta sin aplicar si se cierra la ventana sin querer.
 */
export function AiEditorLauncher({ history }: { history: AiEditEntry[] }) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setEverOpened(true);
          setOpen(true);
        }}
      >
        <Sparkles size={16} className="text-accent" /> Editar con IA
      </Button>
      {everOpened && (
        <SidePanel
          hidden={!open}
          onClose={() => setOpen(false)}
          header={
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">Editar con IA</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Pide el cambio como se lo dirías a un colega. La IA propone la edición, la ves marcada y tú la apruebas: nada se
                aplica solo, y todo se puede revertir.
              </p>
            </div>
          }
        >
          <KnowledgeAiEditor history={history} />
        </SidePanel>
      )}
    </>
  );
}
