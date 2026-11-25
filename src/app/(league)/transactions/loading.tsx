import { Skeleton } from "@/components/ui/core";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading transactions">
      <Skeleton className="mb-4 h-8 w-64 rounded-lg" />
      <Skeleton className="mb-4 h-11 w-72 rounded-lg" />
      <Skeleton className="mb-3 h-10 rounded-full" />
      <div className="space-y-px overflow-hidden rounded-card">
        {Array.from({ length: 10 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-none" />
        ))}
      </div>
    </div>
  );
}
