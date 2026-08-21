"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { RotateCw } from "lucide-react";
import { Button } from "./button";

export function ErrorState({
  error,
  reset,
  message = "Algo salió mal al cargar esto.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  message?: string;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <p className="font-display text-base font-semibold text-ink">{message}</p>
      <p className="max-w-sm text-sm text-ink-muted">
        Ya quedó registrado. Puedes intentar de nuevo o recargar la página.
      </p>
      <Button type="button" variant="secondary" size="sm" onClick={() => reset()}>
        <RotateCw size={14} /> Reintentar
      </Button>
    </div>
  );
}
