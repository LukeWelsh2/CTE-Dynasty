// Loading skeletons for the recap pages.
export function RecapSkeleton({ hero = true }: { hero?: boolean }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading recap">
      {hero ? <div className="mb-4 h-48 rounded-xl bg-brand-900/70" /> : <div className="mb-4 h-14 w-64 rounded-md bg-sunken" />}
      <div className="mb-4 h-9 rounded-lg bg-sunken" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-32 rounded-lg border border-line bg-panel" />
        ))}
      </div>
    </div>
  );
}
