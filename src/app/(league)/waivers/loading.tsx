import { Skeleton } from "@/components/ui/core";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading waivers">
      <Skeleton className="mb-4 h-8 w-56 rounded-lg" />
      <Skeleton className="mb-4 h-11 w-72 rounded-lg" />
      <Skeleton className="mb-4 h-[84px] rounded-card" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Skeleton className="h-48 rounded-card" />
          <Skeleton className="h-72 rounded-card" />
        </div>
        <Skeleton className="h-96 rounded-card" />
      </div>
    </div>
  );
}
