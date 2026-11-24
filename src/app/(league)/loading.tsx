// Fallback loading state for every league page that has no loading.tsx of its own. It renders inside the
// app shell (nav + score ticker stay put), so it only sketches the content area: a page header, a main
// column of cards and a right rail — the composition League Home and most league pages use. Shimmer
// skeletons (the kit's Skeleton), never flat grey blocks; the shimmer stops under reduced motion.
import { Skeleton } from "@/components/ui/core";
import { cn } from "@/lib/utils";

function PanelSkeleton({ rows, className }: { rows: number; className?: string }) {
  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line/70 px-3 py-3 sm:px-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="space-y-3.5 p-3 sm:p-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-[9px]" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className={cn("h-3", i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-4/5" : "w-2/5")} />
              <Skeleton className="h-2.5 w-1/3" />
            </div>
            <Skeleton className="h-3.5 w-10 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LeagueLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-4">
      <span className="sr-only">Loading…</span>

      {/* Page header */}
      <div className="px-0.5 pt-1">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="mt-3 h-8 w-2/3 max-w-sm rounded-lg" />
        <Skeleton className="mt-3 h-3 w-full max-w-xl" />
        <div className="mt-4 flex gap-2 overflow-hidden">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-24 shrink-0 rounded-full sm:h-8" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Matchup-style card */}
          <div className="card overflow-hidden">
            <div className="border-b border-line/70 px-3 py-3 sm:px-4">
              <Skeleton className="h-4 w-36" />
            </div>
            <div className="flex items-start gap-4 p-4">
              <div className="flex flex-1 flex-col gap-2.5">
                <Skeleton className="h-10 w-10 rounded-[11px]" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-10 w-28 rounded-lg" />
              </div>
              <Skeleton circle className="mt-3 h-7 w-7" />
              <div className="flex flex-1 flex-col items-end gap-2.5">
                <Skeleton className="h-10 w-10 rounded-[11px]" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-10 w-28 rounded-lg" />
              </div>
            </div>
            <div className="px-4 pb-4">
              <Skeleton className="h-2.5 w-full rounded-full" />
            </div>
          </div>
          <PanelSkeleton rows={6} />
          <PanelSkeleton rows={4} className="hidden sm:block" />
        </div>

        <div className="min-w-0 space-y-4">
          <PanelSkeleton rows={8} />
          <PanelSkeleton rows={4} className="hidden sm:block" />
        </div>
      </div>
    </div>
  );
}
