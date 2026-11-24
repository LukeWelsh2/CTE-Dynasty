export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading waivers">
      <div className="mb-4 h-8 w-56 rounded bg-sunken" />
      <div className="mb-4 h-9 w-72 rounded bg-sunken" />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-20 rounded-lg border border-line bg-panel" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <div className="h-48 rounded-lg border border-line bg-panel" />
          <div className="h-72 rounded-lg border border-line bg-panel" />
        </div>
        <div className="h-96 rounded-lg border border-line bg-panel" />
      </div>
    </div>
  );
}
