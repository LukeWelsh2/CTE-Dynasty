// Loading skeletons for team pages (server-safe): the kit's shimmer blocks on solid cards.
import { Skeleton } from "@/components/ui/core";
import { cn } from "@/lib/utils";

export function TeamPageSkeleton({ title, panels = 3 }: { title: string; panels?: number }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="mb-3 flex gap-3 overflow-hidden border-b border-line pb-3">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-24 shrink-0" />
        ))}
      </div>
      <Skeleton className="mb-2 h-3 w-32" />
      <div className="mb-4 font-display text-[30px] font-extrabold uppercase leading-[1.02] text-faint/60 sm:text-[36px]">{title}</div>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card px-3.5 py-3">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: panels }, (_, i) => (
          <div key={i} className={cn("card overflow-hidden", i === 0 && "lg:col-span-2")}>
            <div className="border-b border-line/70 px-3 py-3 sm:px-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-2.5 p-3 sm:p-4">
              {Array.from({ length: 5 }, (_, j) => (
                <Skeleton key={j} className="h-6 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
