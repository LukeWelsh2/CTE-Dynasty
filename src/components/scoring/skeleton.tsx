// Loading skeletons for live scoring + schedule pages (server-safe).
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sunken", className)} />;
}

export function ScoreboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading scoreboard">
      <Bar className="mb-1 h-3 w-32" />
      <div className="mb-4 font-display text-2xl font-extrabold uppercase tracking-wide text-muted/70 sm:text-3xl">Live Scoreboard</div>
      <div className="mb-3 flex gap-1 overflow-hidden">
        {Array.from({ length: 17 }, (_, i) => (
          <Bar key={i} className="h-8 w-10 shrink-0" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rounded-lg border border-line bg-panel p-3">
              <Bar className="mb-3 h-3 w-20" />
              {[0, 1].map((j) => (
                <div key={j} className="mb-2.5 flex items-center gap-3">
                  <Bar className="h-10 w-10" />
                  <div className="flex-1 space-y-1.5">
                    <Bar className="h-3.5 w-32" />
                    <Bar className="h-2.5 w-20" />
                  </div>
                  <Bar className="h-7 w-16" />
                </div>
              ))}
              <Bar className="h-1.5 w-full" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-line bg-panel">
              <div className="border-b border-line bg-sunken/70 px-3 py-2.5">
                <Bar className="h-4 w-36" />
              </div>
              <div className="space-y-2 p-3">
                {Array.from({ length: 6 }, (_, j) => (
                  <Bar key={j} className="h-7 w-full" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MatchupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading matchup">
      <div className="mb-3 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <Bar key={i} className="h-12 w-28 shrink-0" />
        ))}
      </div>
      <div className="mb-4 rounded-lg border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-4">
          {[0, 1].map((i) => (
            <div key={i} className="flex min-w-0 flex-1 items-center gap-3">
              <Bar className="h-10 w-10 shrink-0 sm:h-14 sm:w-14" />
              <div className="min-w-0 flex-1 space-y-2">
                <Bar className="h-4 w-full max-w-36" />
                <Bar className="h-8 w-16 sm:w-24" />
              </div>
            </div>
          ))}
        </div>
        <Bar className="mt-4 h-3 w-full" />
      </div>
      <div className="rounded-lg border border-line bg-panel">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-2.5">
            <Bar className="h-8 w-8 rounded-full" />
            <Bar className="h-4 flex-1" />
            <Bar className="h-5 w-10" />
            <Bar className="h-4 flex-1" />
            <Bar className="h-8 w-8 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScheduleSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading schedule">
      <Bar className="mb-1 h-3 w-32" />
      <div className="mb-4 font-display text-2xl font-extrabold uppercase tracking-wide text-muted/70 sm:text-3xl">Schedule</div>
      <Bar className="mb-4 h-9 w-64" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-line bg-panel">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line px-3 py-3">
              <Bar className="h-4 w-10" />
              <Bar className="h-8 w-8" />
              <Bar className="h-4 flex-1" />
              <Bar className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-line bg-panel p-3">
              <Bar className="mb-3 h-4 w-32" />
              {Array.from({ length: 4 }, (_, j) => (
                <Bar key={j} className="mb-2 h-8 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
