import { Skeleton } from "@/components/ui/skeleton";

export default function KnowledgeLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}
