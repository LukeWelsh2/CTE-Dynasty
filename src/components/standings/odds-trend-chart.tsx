"use client";
// Playoff / bye / title odds by week. Up to three highlighted teams get categorical colors (validated
// reference slots 1-3); every other team is a recessive gray context line. One axis (percent).
import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
const CHROME = {
  light: { grid: "#e2e8f0", axis: "#cbd5e1", text: "#64748b", context: "#cbd5e1" },
  dark: { grid: "#23314a", axis: "#334155", text: "#8c9cb6", context: "#334155" },
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-line bg-sunken p-0.5" role="group" aria-label="Odds shown">
          {metrics.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={metric === m.key}
              onClick={() => setMetric(m.key)}
              className={cn("rounded-md px-3 py-1.5 text-xs font-semibold", metric === m.key ? "bg-panel text-ink shadow-panel" : "text-muted hover:text-ink")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted">Highlight up to 3 teams:</span>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Highlighted teams">
        {teams.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(t.id)}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium", on ? "border-ink/30 bg-panel text-ink" : "border-line bg-sunken/60 text-muted hover:text-ink")}
            >
              <span className="inline-block h-0.5 w-3 rounded" style={{ background: on ? colorOf(t.id) : c.context }} aria-hidden />
              {t.name}
            </button>
          );
        })}
      </div>
      {history.length < 2 ? (
        <p className="rounded-md border border-dashed border-line px-3 py-6 text-center text-sm text-muted">The trend fills in as odds are recomputed after each week.</p>
      ) : (
        <div className="h-64 w-full sm:h-72" role="img" aria-label={`${METRICS.find((m) => m.key === metric)!.label} odds by week for every team; the odds table above lists the current values`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
              <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: c.axis }} tick={{ fill: c.text, fontSize: 11 }} tickFormatter={(w) => `Wk ${w}`} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 11 }} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} width={46} />
              <Tooltip
                cursor={{ stroke: c.axis, strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const vals = payload
                    .map((p) => ({ id: String(p.dataKey), v: Number(p.value) }))
                    .filter((p) => byId.has(p.id))
                    .sort((a, b) => (picked.includes(b.id) ? 1 : 0) - (picked.includes(a.id) ? 1 : 0) || b.v - a.v);
                  return (
                    <div className="max-w-[240px] rounded-md border border-line bg-panel px-3 py-2 text-xs shadow-pop">
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
                  activeDot={{ r: 5, strokeWidth: 2, stroke: dark ? "#0f1726" : "#ffffff" }}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
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
