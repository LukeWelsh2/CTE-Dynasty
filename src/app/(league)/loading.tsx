// Fallback loading state for every league page that has no loading.tsx of its own. It renders inside the
// app shell (nav + score ticker stay put), so it only sketches the content area: a page header, a main
// column of panels and a right rail, the same composition the League Home and most league pages use.
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("rounded bg-line/70 dark:bg-line", className)} />;
}

function PanelSkeleton({ rows, className, tall }: { rows: number; className?: string; tall?: boolean }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-line bg-panel shadow-panel", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-line bg-sunken/70 px-3 py-2.5">
        <Bar className="h-3.5 w-32" />
        <Bar className="h-3 w-16" />
      </div>
      <div className={cn("space-y-3 p-3", tall && "space-y-4")}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-7 w-7 shrink-0 rounded-md bg-line/70 dark:bg-line" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Bar className={cn("h-3", i % 3 === 0 ? "w-3/5" : i % 3 === 1 ? "w-4/5" : "w-2/5")} />
              <Bar className="h-2.5 w-1/3 opacity-70" />
            </div>
            <Bar className="h-3 w-10 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LeagueLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse space-y-4 motion-reduce:animate-none">
      <span className="sr-only">Loading…</span>

      {/* Page header */}
      <div className="rounded-xl border border-line bg-panel p-4 shadow-panel sm:p-5">
        <Bar className="h-2.5 w-40 bg-gold-400/50 dark:bg-gold-500/30" />
        <Bar className="mt-3 h-7 w-2/3 max-w-sm" />
        <Bar className="mt-3 h-3 w-full max-w-xl opacity-70" />
        <div className="mt-4 flex gap-2 overflow-hidden">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-7 w-24 shrink-0 rounded-md bg-sunken" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Matchup-style hero card */}
          <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-panel">
            <div className="border-b border-line bg-sunken/70 px-3 py-2.5">
              <Bar className="h-3.5 w-36" />
            </div>
            <div className="flex items-center gap-4 p-4">
              <div className="flex flex-1 items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-lg bg-line/70 dark:bg-line" />
                <div className="flex-1 space-y-2">
                  <Bar className="h-4 w-3/4" />
                  <Bar className="h-8 w-20" />
                </div>
              </div>
              <div className="h-6 w-8 rounded-full bg-sunken" />
              <div className="flex flex-1 flex-row-reverse items-center gap-3">
                <div className="h-11 w-11 shrink-0 rounded-lg bg-line/70 dark:bg-line" />
                <div className="flex flex-1 flex-col items-end space-y-2">
                  <Bar className="h-4 w-3/4" />
                  <Bar className="h-8 w-20" />
                </div>
              </div>
            </div>
            <div className="px-4 pb-4">
              <div className="h-2 w-full rounded-full bg-sunken" />
            </div>
          </div>
          <PanelSkeleton rows={6} />
          <PanelSkeleton rows={4} tall className="hidden sm:block" />
        </div>

        <div className="min-w-0 space-y-4">
          <PanelSkeleton rows={8} />
          <PanelSkeleton rows={4} className="hidden sm:block" />
        </div>
      </div>
    </div>
  );
}
