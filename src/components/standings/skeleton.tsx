// Loading skeletons for standings / power rankings / playoffs (server-safe): the v3 page anatomy — tabs, title,
// summary strip, a card of ranked rows, and (standings) the rail.
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sunken", className)} />;
}

export function StandingsSkeleton({ title, rows = 12, rail = true }: { title: string; rows?: number; rail?: boolean }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="mb-3 flex gap-6 border-b border-line px-3 pb-3 pt-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Bar key={i} className="h-5 w-20" />
        ))}
      </div>
      <Bar className="mb-2 h-3 w-24" />
      <h1 className="mb-4 text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-muted/60 sm:mb-6 sm:text-[30px]">{title}</h1>
      <div className={cn("grid grid-cols-1 gap-4", rail && "xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6")}>
        <div className="min-w-0 space-y-4">
          <div className="card grid grid-cols-4 gap-px overflow-hidden">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="space-y-2 px-3 py-3">
                <Bar className="h-3 w-12" />
                <Bar className="h-6 w-14" />
              </div>
            ))}
          </div>
          <div className="card overflow-hidden">
            {Array.from({ length: rows }, (_, j) => (
              <div key={j} className="flex min-h-[56px] items-center gap-3 border-b border-line/70 px-4 py-2 last:border-0">
                <Bar className="h-4 w-5" />
                <Bar className="h-7 w-7 rounded-md" />
                <div className="flex-1 space-y-1.5">
                  <Bar className="h-4 w-36" />
                  <Bar className="h-3 w-24" />
                </div>
                <Bar className="h-4 w-12" />
              </div>
            ))}
          </div>
        </div>
        {rail && (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="card space-y-3 p-4">
                <Bar className="h-5 w-32" />
                {Array.from({ length: 4 }, (_, j) => (
                  <Bar key={j} className="h-5 w-full" />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
