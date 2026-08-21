"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function KnowledgeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} message="No se pudo cargar el conocimiento del bot." />;
}
