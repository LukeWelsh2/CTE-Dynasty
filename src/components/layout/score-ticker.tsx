"use client";
// Always-visible league scoreboard strip (every matchup this week, live). Click a game for the matchup page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import { cn } from "@/lib/utils";

export interface TickerTeam {
  id: string;
  abbrev: string;
  name: string;
  primaryColor: string;
  score: number;
  projected: number;
  record?: string;
}

export interface TickerMatchup {
  id: string;
  week: number;
  status: string;
  /**
   * the stored row's (and live events') win probability — for a week of an undecided multi-week playoff game the
   * chance to win the whole game (refreshWeekMatchups stores the game odds on every week's row)
   */
  homeWinProb: number;
  /** round label; a week of a multi-week playoff game ends "(Wk 2 of 3)" */
  label?: string | null;
  home: TickerTeam | null;
  away: TickerTeam | null;
}

/** Which week of a multi-week playoff game a row is, from its round label ("Championship (Wk 2 of 3)"). */
export function tickerGameLeg(label: string | null | undefined): { round: string; leg: number; legs: number } | null {
  const m = label?.match(/^(.*) \(Wk (\d+) of (\d+)\)$/);
  return m ? { round: m[1]!, leg: Number(m[2]), legs: Number(m[3]) } : null;
}

export function ScoreTicker({ leagueId, week, matchups: initial, myTeamId }: { leagueId: string; week: number; matchups: TickerMatchup[]; myTeamId?: string | null }) {
  const [matchups, setMatchups] = useState(initial);
  // re-sync with fresh server props after router.refresh() (scores and records)
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setMatchups(initial);
  }
  const [flash, setFlash] = useState<Record<string, number>>({});
  const router = useRouter();

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type === "score.update") {
      const u = e.data as ScoreUpdateEvent;
      if (u.week !== week) return;
      setMatchups((ms) =>
        ms.map((m) =>
          m.id === u.matchupId
            ? {
                ...m,
                status: u.status,
                homeWinProb: u.homeWinProb,
                home: m.home ? { ...m.home, score: u.homeScore, projected: u.homeProjected } : null,
                away: m.away ? { ...m.away, score: u.awayScore, projected: u.awayProjected } : null,
              }
            : m,
        ),
      );
      setFlash((f) => ({ ...f, [u.matchupId]: Date.now() }));
    } else if (e.type === "scores.refresh") {
      router.refresh();
    }
  });

  const sorted = [...matchups].sort((a, b) => {
    const mine = (m: TickerMatchup) => (m.home?.id === myTeamId || m.away?.id === myTeamId ? 0 : 1);
    return mine(a) - mine(b);
  });

  return (
    <div className="border-b border-line bg-panel">
      <div className="mx-auto flex max-w-[1400px] items-stretch">
        <Link href="/scoring" className="flex shrink-0 flex-col items-center justify-center border-r border-line bg-sunken px-3 text-center hover:bg-brand-50 dark:hover:bg-brand-900/30">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Week</span>
          <span className="font-display text-xl font-extrabold leading-none text-ink">{week}</span>
        </Link>
        <div className="scroll-thin flex flex-1 overflow-x-auto">
          {sorted.length === 0 && <div className="flex items-center px-4 text-xs text-muted">No matchups scheduled this week.</div>}
          {sorted.map((m) => {
            const mine = m.home?.id === myTeamId || m.away?.id === myTeamId;
            const live = m.status === "LIVE";
            const final = m.status === "FINAL";
            // a week of a multi-week playoff game: its odds are for the whole game, still open after a final week
            const leg = tickerGameLeg(m.label);
            const gameOpen = !!leg && m.homeWinProb > 0 && m.homeWinProb < 1;
            const showProb = !!m.home && !!m.away && (!final || gameOpen);
            const state = live ? "● Live" : final ? "Final" : leg ? leg.round : m.label ?? "Upcoming";
            return (
              <Link
                key={`${m.id}-${flash[m.id] ?? 0}`}
                href={`/scoring/${m.id}`}
                className={cn(
                  "group min-w-[168px] shrink-0 border-r border-line px-3 py-1.5 text-xs hover:bg-sunken",
                  mine && "bg-gold-300/15",
                  flash[m.id] && "animate-flash",
                )}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-wider">
                  <span className={cn("min-w-0 truncate", live ? "text-live" : "text-muted")} title={m.label ?? undefined}>
                    {state}
                    {leg && ` · Wk ${leg.leg}/${leg.legs}`}
                  </span>
                  {showProb && m.home && m.away && (
                    <span className="shrink-0 text-muted" title={leg ? `Chance to win the ${leg.legs}-week game` : "Win probability"}>
                      {Math.round(Math.max(m.homeWinProb, 1 - m.homeWinProb) * 100)}% {m.homeWinProb >= 0.5 ? m.home.abbrev : m.away.abbrev}
                    </span>
                  )}
                </div>
                {[m.away, m.home].map((t, i) => {
                  if (!t) return <div key={i} className="text-muted">BYE</div>;
                  const other = i === 0 ? m.home : m.away;
                  const winning = other ? t.score > other.score : false;
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2 leading-5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2.5 w-1 rounded-sm" style={{ background: t.primaryColor }} />
                        <span className={cn("truncate font-semibold", t.id === myTeamId && "text-brand-700 dark:text-brand-300")}>{t.abbrev}</span>
                        {t.record && <span className="text-[10px] text-muted">{t.record}</span>}
                      </span>
                      <span className={cn("tabular-nums", (final || live) && winning ? "font-extrabold text-ink" : "font-semibold text-ink/80")}>
                        {m.status === "UPCOMING" ? <span className="text-muted">{t.projected.toFixed(1)}</span> : t.score.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </Link>
            );
          })}
        </div>
        <Link href="/schedule" className="hidden shrink-0 items-center gap-1.5 border-l border-line px-3 text-xs font-semibold text-muted hover:bg-sunken hover:text-ink sm:flex">
          <CalendarDays size={15} /> Schedule
        </Link>
      </div>
    </div>
  );
}
