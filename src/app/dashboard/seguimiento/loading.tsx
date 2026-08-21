import { Skeleton } from "@/components/ui/skeleton";

export default function SeguimientoLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}
