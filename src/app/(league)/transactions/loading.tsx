export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading transactions">
      <div className="mb-4 h-8 w-64 rounded bg-sunken" />
      <div className="mb-4 h-9 w-72 rounded bg-sunken" />
      <div className="mb-3 h-20 rounded-lg border border-line bg-panel" />
      <div className="space-y-px overflow-hidden rounded-lg border border-line">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-16 bg-panel" />
        ))}
      </div>
    </div>
  );
}
