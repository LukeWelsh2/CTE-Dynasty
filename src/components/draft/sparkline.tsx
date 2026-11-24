// Tiny rank-history sparkline (lower rank = higher on the chart). No hooks: works in server and client components.
export function RankSparkline({ values, width = 84, height = 22, label }: { values: (number | null)[]; width?: number; height?: number; label: string }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  // "new" only when there is history the player isn't part of yet; a brand-new class has no trend at all
  if (pts.length < 2) return <span className="text-[10px] text-muted">{pts.length === 1 && values.length > 1 ? "new" : "—"}</span>;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = Math.max(1, max - min);
  const n = Math.max(1, values.length - 1);
  const x = (i: number) => 2 + (i / n) * (width - 4);
  const y = (v: number) => 2 + ((v - min) / span) * (height - 4);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const first = pts[0].v;
  const last = pts[pts.length - 1].v;
  const color = last < first ? "rgb(22 163 74)" : last > first ? "rgb(220 38 38)" : "rgb(100 116 139)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="overflow-visible">
      <title>{label}</title>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts[pts.length - 1].i)} cy={y(last)} r={2.2} fill={color} />
    </svg>
  );
}
