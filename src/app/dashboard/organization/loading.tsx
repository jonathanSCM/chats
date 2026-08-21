import { Skeleton } from "@/components/ui/skeleton";

export default function OrganizationLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-40" />
      <Skeleton className="h-56" />
      <Skeleton className="h-32" />
    </div>
  );
}
