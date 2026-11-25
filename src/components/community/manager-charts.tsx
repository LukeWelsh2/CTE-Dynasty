"use client";
// Manager profile charts: weekly score vs league average (line), salary by position (bars).
// One axis per chart; v3 palette for light + dark (the interactive blue / league average in grey, dashed).
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = {
  light: { team: "#0b5cd5", avg: "#8a9099", grid: "#eceef1", text: "#5c616b", surface: "#ffffff", win: "#167c3a", loss: "#d01f2b", bar: "#0b5cd5" },
  dark: { team: "#5b9bf7", avg: "#9ba1aa", grid: "#26282c", text: "#9ba1aa", surface: "#161719", win: "#2fbf63", loss: "#f2555a", bar: "#5b9bf7" },
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

export interface WeeklyPoint {
  week: number;
  pts: number;
  leagueAvg: number;
  opp: number;
  oppName: string;
  result: "W" | "L" | "T";
  isPlayoff: boolean;
}

export function WeeklyScoresChart({ data, teamLabel }: { data: WeeklyPoint[]; teamLabel: string }) {
  const dark = useDark();
  const c = dark ? COLORS.dark : COLORS.light;
  const avg = data.length ? data.reduce((a, d) => a + d.pts, 0) / data.length : 0;
  const last = data[data.length - 1];
  const values = data.flatMap((d) => [d.pts, d.leagueAvg]);
  const step = 20;
  const lo = values.length ? Math.max(0, Math.floor((Math.min(...values) - 5) / step) * step) : 0;
  const hi = values.length ? Math.ceil((Math.max(...values) + 5) / step) * step : 100;
  const ticks: number[] = [];
  for (let v = lo; v <= hi; v += step * (hi - lo > 160 ? 2 : 1)) ticks.push(v);
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: c.team }} aria-hidden /> {teamLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: c.avg }} aria-hidden /> League average
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.win }} aria-hidden /> Win
          <span className="ml-1 inline-block h-2 w-2 rounded-full" style={{ background: c.loss }} aria-hidden /> Loss
        </span>
        <span className="ml-auto tabular-nums">Season avg {avg.toFixed(1)}</span>
      </figcaption>
      <div className="h-56 w-full sm:h-64" role="img" aria-label={`Weekly score for ${teamLabel} compared with the league average`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 44, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke={c.grid} />
            <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: c.grid }} tick={{ fill: c.text, fontSize: 12 }} tickFormatter={(w) => `W${w}`} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} width={44} allowDecimals={false} domain={[lo, hi]} ticks={ticks} />
            <Tooltip
              cursor={{ stroke: c.text, strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as WeeklyPoint;
                return (
                  <div className="rounded-[10px] bg-raised px-3 py-2 text-xs shadow-pop ring-1 ring-line/70">
                    <div className="mb-1 font-semibold text-muted">
                      Week {d.week}
                      {d.isPlayoff ? " · playoffs" : ""}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-0.5 w-3" style={{ background: c.team }} />
                      <b className="tabular-nums text-ink">{d.pts.toFixed(2)}</b>
                      <span className="text-muted">
                        {d.result === "W" ? "W" : d.result === "L" ? "L" : "T"} vs {d.oppName} ({d.opp.toFixed(2)})
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-0.5 w-3" style={{ background: c.avg }} />
                      <b className="tabular-nums text-ink">{d.leagueAvg.toFixed(2)}</b>
                      <span className="text-muted">league average</span>
                    </div>
                  </div>
                );
              }}
            />
            <Line
              dataKey="leagueAvg"
              type="monotone"
              stroke={c.avg}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, fill: c.avg, stroke: c.surface, strokeWidth: 2 }}
              isAnimationActive={false}
            />
            <Line
              dataKey="pts"
              type="monotone"
              stroke={c.team}
              strokeWidth={2}
              isAnimationActive={false}
              dot={(props: { cx?: number; cy?: number; payload?: WeeklyPoint; index?: number }) => {
                const { cx, cy, payload, index } = props;
                if (cx === undefined || cy === undefined || !payload) return <g key={index} />;
                return <circle key={index} cx={cx} cy={cy} r={4.5} fill={payload.result === "W" ? c.win : payload.result === "L" ? c.loss : c.text} stroke={c.surface} strokeWidth={2} />;
              }}
              activeDot={{ r: 6, fill: c.team, stroke: c.surface, strokeWidth: 2 }}
              label={(props: { x?: number; y?: number; index?: number }) =>
                props.index === data.length - 1 && last ? (
                  <text key="lbl" x={(props.x ?? 0) + 8} y={(props.y ?? 0) + 4} fill={c.text} fontSize={12} fontWeight={600}>
                    {last.pts.toFixed(1)}
                  </text>
                ) : (
                  <g key={`l${props.index}`} />
                )
              }
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

export interface SalaryPoint {
  position: string;
  salary: number;
  count: number;
  share: number;
}

export function SalaryByPositionChart({ data, cap }: { data: SalaryPoint[]; cap: number | null }) {
  const dark = useDark();
  const c = dark ? COLORS.dark : COLORS.light;
  const height = Math.max(140, data.length * 34 + 24);
  return (
    <figure>
      <div style={{ height }} className="w-full" role="img" aria-label="Salary committed by position">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 0 }} barCategoryGap={6}>
            <CartesianGrid horizontal={false} stroke={c.grid} />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 11 }} tickFormatter={(v) => `$${v}`} allowDecimals={false} />
            <YAxis type="category" dataKey="position" tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12, fontWeight: 600 }} width={44} />
            <Tooltip
              cursor={{ fill: dark ? "rgba(91,140,243,0.08)" : "rgba(39,80,201,0.06)" }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as SalaryPoint;
                return (
                  <div className="rounded-[10px] bg-raised px-3 py-2 text-xs shadow-pop ring-1 ring-line/70">
                    <div className="font-semibold text-ink">{d.position}</div>
                    <div className="tabular-nums text-muted">
                      ${d.salary} · {d.count} player{d.count === 1 ? "" : "s"} · {(d.share * 100).toFixed(0)}% of payroll
                      {cap ? ` · ${((d.salary / cap) * 100).toFixed(0)}% of cap` : ""}
                    </div>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="salary"
              fill={c.bar}
              radius={[0, 4, 4, 0]}
              maxBarSize={22}
              isAnimationActive={false}
              label={{ position: "right", fill: c.text, fontSize: 11, formatter: (v: number) => `$${v}` }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
