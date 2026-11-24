// Loading skeletons for team pages (server-safe).
import { cn } from "@/lib/utils";

function Bar({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-sunken", className)} />;
}

export function TeamPageSkeleton({ title, panels = 3 }: { title: string; panels?: number }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`}>
      <div className="mb-3 flex gap-3 border-b border-line pb-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Bar key={i} className="h-5 w-24" />
        ))}
      </div>
      <Bar className="mb-1 h-3 w-32" />
      <div className="mb-4 font-display text-2xl font-extrabold uppercase tracking-wide text-muted/70 sm:text-3xl">{title}</div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-lg border border-line bg-panel p-3">
            <Bar className="mb-2 h-3 w-20" />
            <Bar className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: panels }, (_, i) => (
          <div key={i} className={cn("overflow-hidden rounded-lg border border-line bg-panel", i === 0 && "lg:col-span-2")}>
            <div className="border-b border-line bg-sunken/70 px-3 py-2.5">
              <Bar className="h-4 w-40" />
            </div>
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }, (_, j) => (
                <Bar key={j} className="h-6 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
