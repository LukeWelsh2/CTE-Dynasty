// Loading skeletons for the players pages: title, a chip row, then Roster-pattern rows (headshot · two text lines ·
// two numbers) on one white sheet.
export function TableSkeleton({ rows = 10, title }: { rows?: number; title?: string }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label={title ? `Loading ${title}` : "Loading"}>
      <div className="mb-2 h-3 w-32 rounded bg-sunken" />
      <div className="mb-4 h-8 w-44 rounded bg-sunken" />
      <div className="mb-3 flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-10 w-16 shrink-0 rounded-full bg-sunken" />
        ))}
      </div>
      <div className="-mx-3 bg-panel px-3 sm:mx-0 sm:rounded-card sm:shadow-card">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex min-h-[76px] items-center gap-3 border-b border-line/70 py-2.5 last:border-b-0">
            <div className="h-11 w-11 shrink-0 rounded-full bg-sunken" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3.5 w-32 rounded bg-sunken" />
              <div className="h-3 w-24 rounded bg-sunken" />
            </div>
            <div className="h-6 w-10 rounded bg-sunken" />
            <div className="h-6 w-10 rounded bg-sunken" />
          </div>
        ))}
      </div>
    </div>
  );
}
