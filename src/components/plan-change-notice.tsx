"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { dismissPlanNoticeAction } from "@/server/actions/admin-plans";

/** Aviso emergente para el dueño cuando cambió su plan. Se queda hasta que lo da por visto. */
export function PlanChangeNotice({ message }: { message: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [, startTransition] = useTransition();

  function dismiss() {
    setOpen(false);
    startTransition(async () => {
      await dismissPlanNoticeAction();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={dismiss} title="Tu plan cambió">
      <div className="space-y-4 px-5 py-4">
        <div className="space-y-1 text-sm text-ink">
          {message.split("\n").map((line, i) =>
            line.startsWith("•") ? (
              <p key={i} className="pl-3 text-ink-muted">
                {line}
              </p>
            ) : (
              <p key={i} className={line.endsWith(":") ? "pt-2 font-medium" : ""}>
                {line}
              </p>
            ),
          )}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={dismiss}>
            Entendido
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
