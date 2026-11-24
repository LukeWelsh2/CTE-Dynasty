"use client";
// Horizontal switcher of every matchup in the week (live scores), current one highlighted.
import Link from "next/link";
import { useState } from "react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import { cn } from "@/lib/utils";

export interface StripMatchup {
  id: string;
  status: string;
  home: { id: string; abbrev: string; primaryColor: string; score: number; projected: number } | null;
  away: { id: string; abbrev: string; primaryColor: string; score: number; projected: number } | null;
}

export function MatchupStrip({ leagueId, week, currentId, matchups: initial, myTeamId }: { leagueId: string; week: number; currentId: string; matchups: StripMatchup[]; myTeamId: string | null }) {
  const [ms, setMs] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setMs(initial);
  }
  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "score.update") return;
    const u = e.data as ScoreUpdateEvent;
    if (u.week !== week) return;
    setMs((cur) =>
      cur.map((m) =>
        m.id === u.matchupId
          ? { ...m, status: u.status, home: m.home && { ...m.home, score: u.homeScore, projected: u.homeProjected }, away: m.away && { ...m.away, score: u.awayScore, projected: u.awayProjected } }
          : m,
      ),
    );
  });
  const sorted = [...ms].sort((a, b) => {
    const mine = (m: StripMatchup) => (m.home?.id === myTeamId || m.away?.id === myTeamId ? 0 : 1);
    return mine(a) - mine(b);
  });
  return (
    <nav aria-label={`Week ${week} matchups`} className="scroll-thin -mx-1 mb-3 flex gap-2 overflow-x-auto px-1 pb-1">
      <Link href={`/scoring?week=${week}`} className="flex shrink-0 flex-col justify-center rounded-md border border-line bg-sunken px-3 text-center text-[10px] font-bold uppercase leading-tight tracking-wider text-muted hover:text-ink">
        All
        <span className="text-ink">Wk {week}</span>
      </Link>
      {sorted.map((m) => (
        <Link
          key={m.id}
          href={`/scoring/${m.id}`}
          aria-current={m.id === currentId ? "page" : undefined}
          className={cn(
            "min-w-[124px] shrink-0 rounded-md border px-2.5 py-1 text-xs transition-colors",
            m.id === currentId ? "border-brand-600 bg-brand-50 dark:border-brand-500 dark:bg-brand-900/30" : "border-line bg-panel hover:bg-sunken",
          )}
        >
          {[m.away, m.home].map((t, i) =>
            t ? (
              <div key={t.id} className="flex items-center justify-between gap-2 leading-5">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-1 rounded-sm" style={{ background: t.primaryColor }} aria-hidden />
                  <span className={cn("font-semibold", t.id === myTeamId && "text-brand-700 dark:text-brand-300")}>{t.abbrev}</span>
                </span>
                <span className={cn("tabular-nums", m.status === "UPCOMING" ? "text-muted" : "font-bold")}>{m.status === "UPCOMING" ? t.projected.toFixed(1) : t.score.toFixed(1)}</span>
              </div>
            ) : (
              <div key={i} className="text-muted">BYE</div>
            ),
          )}
          <div className={cn("mt-0.5 text-[9px] font-bold uppercase tracking-wider", m.status === "LIVE" ? "text-live" : "text-muted")}>{m.status === "LIVE" ? "● Live" : m.status === "FINAL" ? "Final" : "Proj"}</div>
        </Link>
      ))}
    </nav>
  );
}
