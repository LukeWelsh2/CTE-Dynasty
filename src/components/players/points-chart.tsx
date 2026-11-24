"use client";
// Weekly fantasy points (bars) with the weekly projection (line), league scoring. One axis: both are points.
import { useEffect, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// v3 chart look (TrendChart): actual points in the one blue, the projection a near-black / light line (dashed in the
// legend), faint horizontal grid, muted axis labels; surfaces match the panel token per theme
const COLORS = {
  light: { actual: "#0b5cd5", proj: "#101114", grid: "#eceef1", text: "#5c616b", surface: "#ffffff" },
  dark: { actual: "#5b9bf7", proj: "#f2f3f5", grid: "#26282c", text: "#9ba1aa", surface: "#161719" },
};

function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

export interface ChartPoint {
  week: number;
  pts: number | null;
  proj: number | null;
}

export function PointsChart({ data, currentWeek }: { data: ChartPoint[]; currentWeek: number }) {
  const dark = useDark();
  const c = dark ? COLORS.dark : COLORS.light;
  const rows = data.map((d) => ({ ...d, label: `Wk ${d.week}` }));
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: c.actual }} aria-hidden /> Actual points
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: c.proj }} aria-hidden /> Projected
        </span>
      </figcaption>
      <div className="h-56 w-full sm:h-64" role="img" aria-label="Weekly fantasy points and projections">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: c.grid }} tick={{ fill: c.text, fontSize: 12 }} interval="preserveStartEnd" />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ fill: dark ? "rgba(91,155,247,0.08)" : "rgba(11,92,213,0.06)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as ChartPoint;
                return (
                  <div className="rounded-xl bg-raised px-3 py-2 text-[13px] shadow-pop">
                    <div className="mb-1 font-semibold text-muted">
                      Week {label}
                      {d.week > currentWeek ? " · upcoming" : ""}
                    </div>
                    {d.week <= currentWeek && (
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-0.5 w-3" style={{ background: c.actual }} />
                        <b className="tabular-nums text-ink">{d.pts === null ? "—" : d.pts.toFixed(1)}</b>
                        <span className="text-muted">actual</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-0.5 w-3" style={{ background: c.proj }} />
                      <b className="tabular-nums text-ink">{d.proj === null ? "—" : d.proj.toFixed(1)}</b>
                      <span className="text-muted">projected</span>
                    </div>
                  </div>
                );
              }}
            />
            <Bar dataKey="pts" fill={c.actual} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            <Line
              dataKey="proj"
              type="monotone"
              stroke={c.proj}
              strokeWidth={1.75}
              strokeDasharray="4 3"
              dot={{ r: 3.5, fill: c.proj, stroke: c.surface, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: c.proj, stroke: c.surface, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
