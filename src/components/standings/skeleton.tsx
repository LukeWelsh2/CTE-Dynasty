// Loading skeletons for standings / power rankings / playoffs (server-safe).
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sunken", className)} />;
}

export function StandingsSkeleton({ title, rows = 12, rail = true }: { title: string; rows?: number; rail?: boolean }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="mb-3 flex gap-3 border-b border-line pb-2">
        {Array.from({ length: 3 }, (_, i) => (
          <Bar key={i} className="h-5 w-28" />
        ))}
      </div>
      <Bar className="mb-1 h-3 w-24" />
      <div className="mb-4 font-display text-2xl font-extrabold uppercase tracking-wide text-muted/70 sm:text-3xl">{title}</div>
      <div className={cn("grid grid-cols-1 gap-4", rail && "xl:grid-cols-[minmax(0,1fr)_300px]")}>
        <div className="overflow-hidden rounded-lg border border-line bg-panel">
          <div className="border-b border-line bg-sunken/70 px-3 py-2.5">
            <Bar className="h-4 w-48" />
          </div>
          <div className="space-y-2 p-3">
            {Array.from({ length: rows }, (_, j) => (
              <Bar key={j} className="h-7 w-full" />
            ))}
          </div>
        </div>
        {rail && (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div key={i} className="overflow-hidden rounded-lg border border-line bg-panel">
                <div className="border-b border-line bg-sunken/70 px-3 py-2.5">
                  <Bar className="h-4 w-32" />
                </div>
                <div className="space-y-2 p-3">
                  {Array.from({ length: 5 }, (_, j) => (
                    <Bar key={j} className="h-5 w-full" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
