"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} message="No se pudo cargar la bandeja de chats." />;
}
