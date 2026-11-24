"use client";
// Playoff / bye / title odds by week. Up to three highlighted teams get categorical colors (validated
// reference slots 1-3); every other team is a recessive gray context line. One axis (percent).
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SegmentedControl } from "@/components/ui/client";
import { ScrollRow } from "@/components/ui/scroll-row";
import { cn } from "@/lib/utils";

type Metric = "playoff" | "bye" | "champ";

export interface TrendTeam {
  id: string;
  name: string;
  abbrev: string;
}

export interface TrendPoint {
  week: number;
  teams: Record<string, { playoff: number; bye: number; champ: number }>;
}

const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a"],
  dark: ["#3987e5", "#d95926", "#199e70"],
};
// theme tokens (docs/DESIGN.md §1): hairline grid, muted text, recessive grey context lines
const CHROME = {
  light: { grid: "#eceef1", axis: "#e3e5e9", text: "#5c616b", context: "#d3d6dc" },
  dark: { grid: "#26282c", axis: "#2c2e33", text: "#9ba1aa", context: "#3a3d43" },
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

const METRICS: { key: Metric; label: string }[] = [
  { key: "playoff", label: "Make playoffs" },
  { key: "bye", label: "Bye" },
  { key: "champ", label: "Win title" },
];

export function OddsTrendChart({ teams, history, initial, byes }: { teams: TrendTeam[]; history: TrendPoint[]; initial: string[]; byes: number }) {
  const dark = useDark();
  const c = dark ? CHROME.dark : CHROME.light;
  const palette = dark ? SERIES.dark : SERIES.light;
  const [metric, setMetric] = useState<Metric>("playoff");
  const [picked, setPicked] = useState<string[]>(() => initial.filter((id) => teams.some((t) => t.id === id)).slice(0, 3));
  const colorOf = (id: string) => palette[picked.indexOf(id)] ?? c.context;
  const byId = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const rows = useMemo(
    () =>
      history.map((h) => {
        const row: Record<string, number | string> = { week: h.week };
        for (const t of teams) {
          const v = h.teams[t.id];
          if (v) row[t.id] = Math.round(v[metric] * 1000) / 10;
        }
        return row;
      }),
    [history, teams, metric],
  );
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 3 ? [...cur.slice(1), id] : [...cur, id]));
  const metrics = METRICS.filter((m) => m.key !== "bye" || byes > 0);
  const context = teams.filter((t) => !picked.includes(t.id));

  return (
    <div>
      <SegmentedControl<Metric> ariaLabel="Odds shown" value={metric} onChange={setMetric} options={metrics.map((m) => ({ value: m.key, label: m.label }))} />
      <p className="mb-1.5 mt-3 text-[13px] text-muted">Highlight up to 3 teams</p>
      {/* one scrolling row of team chips (fades at the edge that has more) */}
      <ScrollRow role="group" aria-label="Highlighted teams" className="-mx-4 mb-3 gap-2 px-4 pb-1">
        {teams.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.id)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors sm:h-8 sm:px-3",
                on ? "bg-panel text-ink shadow-[inset_0_0_0_1.5px_rgb(var(--c-ink)/0.35)]" : "bg-sunken text-muted hover:text-ink",
              )}
            >
              <span className="inline-block h-[3px] w-3.5 rounded" style={{ background: on ? colorOf(t.id) : c.context }} aria-hidden />
              {t.name}
            </button>
          );
        })}
      </ScrollRow>
      {history.length < 2 ? (
        <p className="rounded-lg bg-sunken px-3 py-6 text-center text-[13px] text-muted">The trend fills in as odds are recomputed after each week.</p>
      ) : (
        <div className="h-64 w-full select-none sm:h-72" style={{ touchAction: "pan-y" }} role="img" aria-label={`${METRICS.find((m) => m.key === metric)!.label} odds by week for every team; the odds table above lists the current values`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: c.axis }} tick={{ fill: c.text, fontSize: 12 }} tickFormatter={(w) => `Wk ${w}`} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} width={46} />
              <Tooltip
                cursor={{ stroke: c.text, strokeWidth: 1, strokeDasharray: "3 3" }}
                allowEscapeViewBox={{ x: false, y: false }}
                wrapperStyle={{ outline: "none", zIndex: 10 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const vals = payload
                    .map((p) => ({ id: String(p.dataKey), v: Number(p.value) }))
                    .filter((p) => byId.has(p.id))
                    .sort((a, b) => (picked.includes(b.id) ? 1 : 0) - (picked.includes(a.id) ? 1 : 0) || b.v - a.v);
                  return (
                    <div className="raised max-w-[240px] px-3 py-2 text-[12px]">
                      <div className="mb-1 font-semibold text-muted">After Week {label}</div>
                      <ul className="space-y-0.5">
                        {vals.map((p) => (
                          <li key={p.id} className={cn("flex items-center gap-2", picked.includes(p.id) ? "text-ink" : "text-muted")}>
                            <span className="inline-block h-0.5 w-3 shrink-0 rounded" style={{ background: colorOf(p.id) }} />
                            <b className="w-11 shrink-0 text-right tabular-nums text-ink">{p.v.toFixed(p.v > 0 && p.v < 1 ? 1 : 0)}%</b>
                            <span className="truncate">{byId.get(p.id)!.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }}
              />
              {context.map((t) => (
                <Line key={t.id} dataKey={t.id} stroke={c.context} strokeWidth={1.25} dot={false} activeDot={false} isAnimationActive={false} connectNulls />
              ))}
              {picked.map((id) => (
                <Line
                  key={id}
                  dataKey={id}
                  stroke={colorOf(id)}
                  strokeWidth={2.25}
                  dot={{ r: 3, strokeWidth: 0, fill: colorOf(id) }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: dark ? "#161719" : "#ffffff" }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        {picked.map((id) => (
          <span key={id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: colorOf(id) }} aria-hidden />
            {byId.get(id)?.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: c.context }} aria-hidden />
          Other teams
        </span>
      </div>
    </div>
  );
}
