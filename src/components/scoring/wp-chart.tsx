"use client";
// Win-probability history for one matchup (left team's chance over time). One series, one axis:
// a 2px line on a recessive grid, a solid 50% reference hairline, crosshair tooltip with the score.
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import type { BigPlay, WpPoint } from "@/lib/live/types";
import { timeLabel } from "@/lib/live/format";

// Validated against light (#fff) and dark (#0f1726) panel surfaces
const COLORS = {
  light: { line: "#2750c9", grid: "#e2e8f0", ref: "#cbd5e1", text: "#64748b" },
  dark: { line: "#5b8cf3", grid: "#23314a", ref: "#33445f", text: "#8c9cb6" },
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

interface Row {
  t: number;
  wp: number;
  left: number;
  right: number;
}

export function WinProbChart({
  leagueId,
  matchupId,
  points: initial,
  leftIsHome,
  leftName,
  rightName,
  tz,
  status,
  plays = [],
}: {
  leagueId: string;
  matchupId: string;
  points: WpPoint[];
  leftIsHome: boolean;
  leftName: string;
  rightName: string;
  tz: string;
  status: string;
  /** scoring plays for these two teams, used to label the biggest swings */
  plays?: BigPlay[];
}) {
  const dark = useDark();
  const c = dark ? COLORS.dark : COLORS.light;
  const toRow = (p: WpPoint): Row => ({
    t: new Date(p.at).getTime(),
    wp: Math.round((leftIsHome ? p.homeWinProb : 1 - p.homeWinProb) * 1000) / 10,
    left: leftIsHome ? p.homeScore : p.awayScore,
    right: leftIsHome ? p.awayScore : p.homeScore,
  });
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setRows(initial.map(toRow));
  }

  // extend the line live between server refreshes
  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "score.update") return;
    const u = e.data as ScoreUpdateEvent;
    if (u.matchupId !== matchupId || u.status === "UPCOMING") return;
    setRows((r) => [...r, toRow({ at: new Date().toISOString(), homeWinProb: u.homeWinProb, homeScore: u.homeScore, awayScore: u.awayScore })]);
  });

  const span = rows.length ? rows[rows.length - 1]!.t - rows[0]!.t : 0;
  if (rows.length < 2 || span < 30_000) {
    const msg =
      status === "UPCOMING"
        ? "The win-probability timeline starts when the first player in this matchup kicks off."
        : status === "FINAL"
          ? "No in-game win-probability history was recorded for this matchup."
          : "The timeline fills in as scores change during the games.";
    return <p className="px-2 py-8 text-center text-sm text-muted">{msg}</p>;
  }
  const showSeconds = span < 20 * 60_000;
  const last = rows[rows.length - 1]!;
  const swings = biggestSwings(rows, plays);

  return (
    <figure>
      <figcaption className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>
          <span className="inline-block h-0.5 w-4 rounded align-middle" style={{ background: c.line }} aria-hidden /> {leftName} win probability
        </span>
        <span className="tabular-nums">
          Now <span className="font-semibold text-ink">{Math.round(last.wp)}%</span>
        </span>
      </figcaption>
      <div className="h-48 w-full sm:h-56" role="img" aria-label={`${leftName} win probability over time, currently ${Math.round(last.wp)}%`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => timeLabel(new Date(t), tz, showSeconds)}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              tick={{ fill: c.text, fontSize: 11 }}
              minTickGap={40}
            />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 11 }} width={40} />
            <ReferenceLine y={50} stroke={c.ref} strokeWidth={1} />
            <Tooltip
              cursor={{ stroke: c.text, strokeWidth: 1 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as Row;
                return (
                  <div className="rounded-md border border-line bg-panel px-3 py-2 text-xs shadow-pop">
                    <div className="mb-1 font-semibold text-muted">{timeLabel(new Date(d.t), tz, showSeconds)}</div>
                    <div className="font-semibold text-ink">{leftName} {d.wp.toFixed(1)}%</div>
                    <div className="tabular-nums text-muted">
                      {d.left.toFixed(2)} – {d.right.toFixed(2)} {rightName}
                    </div>
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey="wp" stroke={c.line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: dark ? "#0f1726" : "#ffffff" }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {swings.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted">Biggest swings</div>
          <ul className="space-y-1 text-xs">
            {swings.map((s) => (
              <li key={s.t} className="flex items-start gap-2">
                <span className={`w-12 shrink-0 text-right font-bold tabular-nums ${s.delta >= 0 ? "text-win" : "text-loss"}`}>
                  {s.delta >= 0 ? "+" : "−"}
                  {Math.abs(Math.round(s.delta))}%
                </span>
                <span className="min-w-0 flex-1 truncate text-ink/85" title={s.label}>
                  {s.label}
                </span>
                <span className="shrink-0 tabular-nums text-muted">{timeLabel(new Date(s.t), tz)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </figure>
  );
}

/** Largest win-probability moves (≥ 5 pts), labeled with the scoring play(s) recorded in that window. */
function biggestSwings(rows: Row[], plays: BigPlay[]): { t: number; delta: number; label: string }[] {
  const out: { t: number; delta: number; label: string }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const delta = rows[i]!.wp - rows[i - 1]!.wp;
    if (Math.abs(delta) < 5) continue;
    const from = rows[i - 1]!.t;
    const to = rows[i]!.t + 10_000;
    const inWindow = plays.filter((p) => {
      const t = new Date(p.at).getTime();
      return t > from && t <= to;
    });
    const best = inWindow.sort((a, b) => Math.abs(b.points) - Math.abs(a.points))[0];
    out.push({ t: rows[i]!.t, delta, label: best ? `${best.description}${inWindow.length > 1 ? ` +${inWindow.length - 1} more` : ""}` : "Scoring change" });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 3);
}
