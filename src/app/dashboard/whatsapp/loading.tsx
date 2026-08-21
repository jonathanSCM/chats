import { Skeleton } from "@/components/ui/skeleton";

export default function WhatsAppLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  );
}
