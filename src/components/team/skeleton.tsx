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
      <div className="mb-4 text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-faint/60 sm:text-[30px]">{title}</div>
      {/* the summary strip: one card, four numbers */}
      <div className="card mb-4 grid grid-cols-4 gap-px overflow-hidden bg-line/80 dark:bg-white/[0.07]">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="bg-panel px-3 py-3">
            <Skeleton className="mb-2 h-3 w-12" />
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: panels }, (_, i) => (
          <div key={i} className={cn("card overflow-hidden", i === 0 && "lg:col-span-2")}>
            <div className="px-4 pb-2 pt-4">
              <Skeleton className="h-4 w-40" />
            </div>
            <div className="space-y-2.5 px-4 pb-4">
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
