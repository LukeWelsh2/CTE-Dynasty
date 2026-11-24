// Loading skeletons for live scoring + schedule pages (server-safe).
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sunken", className)} />;
}

export function ScoreboardSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading scoreboard">
      <Bar className="mb-2 h-3 w-32" />
      <h1 className="mb-4 text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-muted/60 sm:mb-6 sm:text-[30px]">Scoreboard</h1>
      <div className="mb-3 flex gap-1.5 overflow-hidden">
        {Array.from({ length: 12 }, (_, i) => (
          <Bar key={i} className="h-10 w-10 shrink-0 rounded-full sm:h-8" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
        <div className="space-y-4">
          <div className="card grid grid-cols-3 overflow-hidden">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="space-y-2 px-3 py-3">
                <Bar className="h-3 w-14" />
                <Bar className="h-6 w-16" />
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="space-y-2 border-b border-line/70 px-4 py-3 last:border-0">
                {[0, 1].map((j) => (
                  <div key={j} className="flex items-center gap-2.5">
                    <Bar className="h-7 w-7 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                      <Bar className="h-4 w-36" />
                      <Bar className="h-3 w-16" />
                    </div>
                    <Bar className="h-6 w-14" />
                    <Bar className="h-4 w-9" />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-4">
          {[0, 1].map((i) => (
            <div key={i} className="card space-y-3 p-4">
              <Bar className="h-5 w-28" />
              {Array.from({ length: 5 }, (_, j) => (
                <Bar key={j} className="h-8 w-full" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MatchupSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading matchup" className="space-y-4">
      <div className="flex h-10 items-center justify-between">
        <Bar className="h-4 w-24" />
        <Bar className="h-4 w-20" />
      </div>
      <div className="-mx-3 bg-panel px-4 pb-3 pt-3 sm:mx-0 sm:rounded-card sm:px-5 sm:shadow-card">
        <div className="h-9 animate-pulse rounded-full bg-brand-600/20" />
        <div className="mx-auto mt-4 flex max-w-[560px] items-start justify-between gap-2">
          <Bar className="h-[52px] w-[52px] rounded-full" />
          <Bar className="mt-2 h-9 w-20" />
          <Bar className="mt-2 h-[34px] w-[34px] rounded-[9px]" />
          <Bar className="mt-2 h-9 w-20" />
          <Bar className="h-[52px] w-[52px] rounded-full" />
        </div>
        <Bar className="mx-auto mt-4 h-4 w-48" />
        <Bar className="mt-3 h-1.5 w-full" />
        <Bar className="mt-4 h-10 w-full rounded-[10px]" />
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex min-h-[76px] items-center gap-3 border-b border-line/70 last:border-0">
            <div className="flex-1 space-y-1.5">
              <Bar className="h-4 w-20" />
              <Bar className="h-3 w-14" />
              <Bar className="h-3 w-24" />
            </div>
            <Bar className="h-7 w-11" />
            <Bar className="h-7 w-11" />
            <div className="flex flex-1 flex-col items-end space-y-1.5">
              <Bar className="h-4 w-20" />
              <Bar className="h-3 w-14" />
              <Bar className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ScheduleSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading schedule">
      <Bar className="mb-2 h-3 w-32" />
      <h1 className="mb-4 text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-muted/60 sm:mb-6 sm:text-[30px]">Schedule</h1>
      <Bar className="mb-4 h-10 w-64 rounded-[10px]" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div className="space-y-4">
          <div className="card grid grid-cols-4 overflow-hidden">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-2 px-3 py-3">
                <Bar className="h-3 w-10" />
                <Bar className="h-6 w-12" />
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="flex min-h-[60px] items-center gap-3 border-b border-line/70 px-4 py-2 last:border-0">
                <Bar className="h-5 w-6" />
                <Bar className="h-7 w-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-4 w-40" />
                  <Bar className="h-3 w-28" />
                </div>
                <Bar className="h-8 w-16" />
              </div>
            ))}
          </div>
        </div>
        <div className="card space-y-3 p-4">
          <Bar className="h-5 w-28" />
          {Array.from({ length: 5 }, (_, j) => (
            <Bar key={j} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
