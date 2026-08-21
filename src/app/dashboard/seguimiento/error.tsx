"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function SeguimientoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} message="No se pudo cargar el seguimiento." />;
}
