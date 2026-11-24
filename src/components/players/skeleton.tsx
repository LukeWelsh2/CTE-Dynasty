// Loading skeletons for the players pages
export function TableSkeleton({ rows = 12, title }: { rows?: number; title?: string }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label={title ? `Loading ${title}` : "Loading"}>
      <div className="mb-4 h-8 w-48 rounded bg-sunken" />
      <div className="mb-3 h-20 rounded-lg border border-line bg-panel" />
      <div className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="h-8 border-b border-line bg-sunken" />
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 border-b border-line/70 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-sunken" />
            <div className="h-3 w-40 rounded bg-sunken" />
            <div className="ml-auto h-3 w-24 rounded bg-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}
