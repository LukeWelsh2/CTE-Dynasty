export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading player">
      <div className="h-3 w-40 rounded bg-sunken" />
      <div className="flex gap-4 rounded-xl border border-line bg-panel p-4">
        <div className="h-28 w-28 rounded-full bg-sunken" />
        <div className="flex-1 space-y-2">
          <div className="h-8 w-64 rounded bg-sunken" />
          <div className="h-4 w-48 rounded bg-sunken" />
          <div className="h-16 w-full max-w-lg rounded bg-sunken" />
        </div>
      </div>
      <div className="h-9 rounded bg-sunken" />
      <div className="h-64 rounded-lg border border-line bg-panel" />
    </div>
  );
}
