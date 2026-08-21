import { Skeleton } from "@/components/ui/skeleton";

export default function AdminSettingsLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-48" />
      <Skeleton className="h-48" />
    </div>
  );
}
