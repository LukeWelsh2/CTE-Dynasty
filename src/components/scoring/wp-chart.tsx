"use client";
// Win-probability history for one matchup (left team's chance over time). One series, one axis:
// a 2px line on a recessive grid, a solid 50% reference hairline, crosshair tooltip with the score.
import { useEffect, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import type { BigPlay, WpPoint } from "@/lib/live/types";
import { Activity } from "lucide-react";
import { timeLabel } from "@/lib/live/format";

// Theme tokens (docs/DESIGN.md): hairline / muted text per theme; the line is the brand action blue, validated against
// the light (#fff) and dark (#161719) panel surfaces
const COLORS = {
  light: { line: "#0b5cd5", grid: "#eceef1", ref: "#c3c8d0", text: "#5c616b", dot: "#ffffff" },
  dark: { line: "#5b9bf7", grid: "#26282c", ref: "#4a4e56", text: "#9ba1aa", dot: "#161719" },
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
      status === "UPCOMING" ? "Starts at the first kickoff" : status === "FINAL" ? "No in-game history recorded" : "Fills in as scores change";
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Activity size={15} className="shrink-0" aria-hidden />
        {msg}
      </p>
    );
  }
  const showSeconds = span < 20 * 60_000;
  const last = rows[rows.length - 1]!;
  const swings = biggestSwings(rows, plays);

  return (
    <figure>
      <figcaption className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 shrink-0 rounded" style={{ background: c.line }} aria-hidden />
          <span className="truncate">{leftName} win probability</span>
        </span>
        <span className="shrink-0">
          Now <span className="numeral text-[15px] font-semibold text-ink">{Math.round(last.wp)}%</span>
        </span>
      </figcaption>
      {/* touch: a horizontal drag scrubs the crosshair, a vertical one still scrolls the page; a tap shows the tooltip */}
      <div className="h-52 w-full select-none sm:h-56" style={{ touchAction: "pan-y" }} role="img" aria-label={`${leftName} win probability over time, currently ${Math.round(last.wp)}%`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 14, bottom: 0, left: 2 }}>
            <CartesianGrid vertical={false} stroke={c.grid} strokeWidth={1} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(t: number) => timeLabel(new Date(t), tz, showSeconds)}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              tick={{ fill: c.text, fontSize: 12 }}
              tickMargin={6}
              minTickGap={48}
            />
            <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} tick={{ fill: c.text, fontSize: 12 }} width={44} />
            <ReferenceLine y={50} stroke={c.ref} strokeWidth={1} />
            <Tooltip
              cursor={{ stroke: c.text, strokeWidth: 1, strokeDasharray: "3 3" }}
              allowEscapeViewBox={{ x: false, y: false }}
              wrapperStyle={{ outline: "none", zIndex: 10 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]!.payload as Row;
                return (
                  <div className="raised px-3 py-2 text-xs">
                    <div className="mb-0.5 font-medium text-muted">{timeLabel(new Date(d.t), tz, showSeconds)}</div>
                    <div className="font-semibold text-ink">
                      {leftName} <span className="numeral">{d.wp.toFixed(1)}%</span>
                    </div>
                    <div className="numeral text-muted">
                      {leftName} {d.left.toFixed(2)} – {d.right.toFixed(2)} {rightName}
                    </div>
                  </div>
                );
              }}
            />
            <Line type="linear" dataKey="wp" stroke={c.line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: c.dot }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {swings.length > 0 && (
        <div className="mt-3 border-t border-line/70 pt-3">
          <h3 className="eyebrow mb-1.5">Biggest swings</h3>
          <ul className="space-y-1.5 text-[13px]">
            {swings.map((s) => (
              <li key={s.t} className="flex items-start gap-2.5">
                <span className={`numeral w-11 shrink-0 text-right font-semibold ${s.delta >= 0 ? "text-win" : "text-loss"}`}>
                  {s.delta >= 0 ? "+" : "−"}
                  {Math.abs(Math.round(s.delta))}%
                </span>
                <span className="min-w-0 flex-1 text-ink">{s.label}</span>
                <span className="numeral shrink-0 text-xs text-muted">{timeLabel(new Date(s.t), tz)}</span>
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
