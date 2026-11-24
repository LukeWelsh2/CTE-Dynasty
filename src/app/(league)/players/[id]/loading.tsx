export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading player">
      <div className="h-4 w-20 rounded bg-sunken" />
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 shrink-0 rounded-full bg-sunken" />
        <div className="flex-1 space-y-2">
          <div className="h-7 w-48 rounded bg-sunken" />
          <div className="h-4 w-36 rounded bg-sunken" />
        </div>
      </div>
      <div className="card h-16" />
      <div className="card grid h-20 grid-cols-4 gap-px overflow-hidden" />
      <div className="h-10 rounded bg-sunken" />
      <div className="card h-64" />
    </div>
  );
}
