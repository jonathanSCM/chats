"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function WhatsAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} message="No se pudo cargar la conexión de WhatsApp." />;
}
