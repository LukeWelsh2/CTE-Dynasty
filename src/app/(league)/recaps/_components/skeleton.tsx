// Loading skeletons for the recap pages.
export function RecapSkeleton({ hero = true }: { hero?: boolean }) {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading recap">
      {hero ? (
        <div className="mb-4 space-y-2">
          <div className="h-4 w-40 rounded bg-sunken" />
          <div className="h-8 w-4/5 rounded-lg bg-sunken" />
          <div className="h-16 rounded-lg bg-sunken" />
        </div>
      ) : (
        <div className="mb-4 h-14 w-64 rounded-md bg-sunken" />
      )}
      <div className="card mb-4 h-20" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="card h-32" />
        ))}
      </div>
    </div>
  );
}
