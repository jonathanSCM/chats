"use client";

import { ErrorState } from "@/components/ui/error-state";

export default function OrganizationError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorState error={error} reset={reset} message="No se pudo cargar la organización." />;
}
