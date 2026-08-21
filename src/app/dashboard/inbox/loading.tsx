import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <div className="flex h-full gap-4">
      <div className="w-72 shrink-0 space-y-2">
        <Skeleton className="h-8 w-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <div className="flex-1 space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
