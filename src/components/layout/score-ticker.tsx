"use client";
// Always-visible league scoreboard strip (every matchup this week, live). Click a game for the matchup page.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import { cn } from "@/lib/utils";
import { ScrollRow } from "@/components/ui/scroll-row";
import { LiveDot } from "@/components/ui/core";

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

/**
 * A ticker card's header: its state ("● Live" / "Final" / the round / "Upcoming", plus "Wk 2/3" for a week of a
 * multi-week playoff game) and the favorite's odds. A week of an undecided multi-week game carries the whole game's
 * odds (refreshWeekMatchups), so they stay up after that week goes final; a decided game (1 / 0) or a single final
 * week shows none.
 */
export function tickerHeader(m: Pick<TickerMatchup, "status" | "homeWinProb" | "label" | "home" | "away">): {
  state: string;
  leg: string | null;
  odds: { pct: string; abbrev: string; title: string } | null;
} {
  const live = m.status === "LIVE";
  const final = m.status === "FINAL";
  const leg = tickerGameLeg(m.label);
  const gameOpen = !!leg && m.homeWinProb > 0 && m.homeWinProb < 1;
  const state = live ? "● Live" : final ? "Final" : leg ? leg.round : m.label ?? "Upcoming";
  // the favorite's chance, worded like the home / scoring views (an undecided game never reads 100%)
  const fav = Math.max(m.homeWinProb, 1 - m.homeWinProb);
  const odds =
    m.home && m.away && (!final || gameOpen)
      ? {
          pct: fav >= 1 ? "100%" : fav > 0.995 ? ">99%" : `${Math.round(fav * 100)}%`,
          abbrev: m.homeWinProb >= 0.5 ? m.home.abbrev : m.away.abbrev,
          title: leg ? `Chance to win the ${leg.legs}-week game` : "Win probability",
        }
      : null;
  return { state, leg: leg ? `Wk ${leg.leg}/${leg.legs}` : null, odds };
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
    <div className="border-b border-line/80 bg-panel">
      <div className="mx-auto flex max-w-[1400px] items-stretch">
        <Link
          href="/scoring"
          aria-label={`Week ${week} scoreboard`}
          className="flex min-w-[3.5rem] shrink-0 flex-col items-center justify-center border-r border-line/70 px-2.5 text-center transition-colors hover:bg-sunken sm:px-3"
        >
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Week</span>
          <span className="font-display text-[22px] font-extrabold leading-none text-ink">{week}</span>
        </Link>
        <ScrollRow aria-label={`Week ${week} matchups`} className="min-w-0 flex-1 scroll-px-1.5 gap-1.5 px-1.5 py-1.5">
          {sorted.length === 0 && <div className="flex items-center px-3 text-xs text-muted">No matchups scheduled this week.</div>}
          {sorted.map((m) => {
            const mine = m.home?.id === myTeamId || m.away?.id === myTeamId;
            const live = m.status === "LIVE";
            const final = m.status === "FINAL";
            // a week of a multi-week playoff game: its odds are for the whole game, still open after a final week
            const head = tickerHeader(m);
            return (
              <Link
                key={`${m.id}-${flash[m.id] ?? 0}`}
                href={`/scoring/${m.id}`}
                aria-label={m.away && m.home ? `${m.away.name} at ${m.home.name}` : "Matchup"}
                className={cn(
                  "group min-w-[156px] shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition-colors sm:min-w-[164px]",
                  mine ? "bg-gold-400/[0.13] ring-1 ring-inset ring-gold-500/35 hover:bg-gold-400/[0.18]" : "bg-sunken hover:bg-ink/[0.06] dark:hover:bg-white/[0.07]",
                  flash[m.id] && "animate-flash",
                )}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[11px] font-bold uppercase leading-4 tracking-[0.05em]">
                  <span className={cn("flex min-w-0 items-center gap-1 truncate", live ? "text-live" : "text-muted")} title={m.label ?? undefined}>
                    {live && <LiveDot className="h-1.5 w-1.5" />}
                    <span className="truncate">
                      {live ? head.state.replace(/^● /, "") : head.state}
                      {head.leg && ` · ${head.leg}`}
                    </span>
                  </span>
                  {head.odds && (
                    <span className="shrink-0 text-muted" title={head.odds.title}>
                      {head.odds.pct} {head.odds.abbrev}
                    </span>
                  )}
                </div>
                {[m.away, m.home].map((t, i) => {
                  if (!t) return <div key={i} className="leading-5 text-muted">BYE</div>;
                  const other = i === 0 ? m.home : m.away;
                  const winning = other ? t.score > other.score : false;
                  const settled = final || live;
                  return (
                    <div key={t.id} className="flex items-center justify-between gap-2 leading-5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-black/10 dark:ring-white/30" style={{ background: t.primaryColor }} aria-hidden />
                        <span className={cn("truncate font-semibold", t.id === myTeamId ? "text-brand-700 dark:text-brand-300" : settled && !winning ? "text-ink/70" : "text-ink")}>{t.abbrev}</span>
                        {t.record && <span className="shrink-0 text-[11px] text-muted">{t.record}</span>}
                      </span>
                      <span className={cn("numeral shrink-0 text-[13px]", settled && winning ? "font-bold text-ink" : settled ? "font-medium text-ink/60" : "font-medium text-muted")}>
                        {m.status === "UPCOMING" ? t.projected.toFixed(1) : t.score.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </Link>
            );
          })}
        </ScrollRow>
        <Link href="/schedule" className="hidden shrink-0 items-center gap-1.5 border-l border-line/70 px-3 text-xs font-semibold text-muted transition-colors hover:bg-sunken hover:text-ink sm:flex">
          <CalendarDays size={15} aria-hidden /> Schedule
        </Link>
      </div>
    </div>
  );
}
