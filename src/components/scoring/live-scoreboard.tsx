"use client";
// League scoreboard: every matchup of the week as a live card (scores, live projections, win
// probability, players left, top performers). score.update patches cards in place with a flash;
// scores.refresh / structural changes trigger a throttled router.refresh().
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import type { CardSide, ScoreboardCard } from "@/lib/live/types";
import { fmtScore } from "@/lib/live/format";
import { TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { MatchupStatus, TeamRecord, WinProbBar } from "./bits";
import { patchGameWeek, PlayoffGameLine, type PlayoffGameContext } from "./playoff-game";

/** A scoreboard card; `game` = a week of a multi-week playoff game (then homeWinProb is for the whole game). */
export type LiveCard = ScoreboardCard & { game?: PlayoffGameContext | null };

/** router.refresh() at most once per `ms` (coalesces bursts of live events) */
export function useThrottledRefresh(ms = 15_000) {
  const router = useRouter();
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (immediate = false) => {
    const now = Date.now();
    const wait = immediate ? 0 : Math.max(0, last.current + ms - now);
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      last.current = Date.now();
      router.refresh();
    }, wait);
  };
}

export function LiveScoreboard({ leagueId, week, cards: initial }: { leagueId: string; week: number; cards: LiveCard[] }) {
  const [cards, setCards] = useState(initial);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setCards(initial);
  }
  const refresh = useThrottledRefresh(20_000);

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type === "score.update") {
      const u = e.data as ScoreUpdateEvent;
      if (u.week !== week) return;
      setCards((cs) =>
        cs.map((c) =>
          c.id === u.matchupId
            ? {
                ...c,
                status: u.status,
                // stored odds (and so the event's) are whole-game odds for a week of a multi-week playoff game
                homeWinProb: u.homeWinProb,
                game: c.game ? patchGameWeek(c.game, c.id, u.homeScore, u.awayScore, u.status) : c.game,
                home: c.home ? { ...c.home, score: u.homeScore, projected: u.homeProjected } : null,
                away: c.away ? { ...c.away, score: u.awayScore, projected: u.awayProjected } : null,
              }
            : c,
        ),
      );
      setFlash((f) => ({ ...f, [u.matchupId]: Date.now() }));
      refresh(); // counts + top performers catch up shortly after
    } else if (e.type === "scores.refresh") {
      if ((e.data as ScoresRefreshEvent).week === week) refresh(true);
    }
  });

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {cards.map((c) => (
        <MatchupCard key={c.id} card={c} flashKey={flash[c.id] ?? 0} />
      ))}
    </div>
  );
}

function SideRow({ side, other, status, flashKey }: { side: CardSide; other: CardSide | null; status: string; flashKey: number }) {
  const upcoming = status === "UPCOMING";
  const leading = !upcoming && other ? side.score > other.score : false;
  return (
    <div className="flex items-center gap-3">
      <TeamLogo team={side.team} size={40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {side.seed && <span className="text-[10px] font-bold text-muted">#{side.seed}</span>}
          <span className="truncate font-semibold text-ink">{side.team.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <TeamRecord record={side.team.record} />
          {side.top && !upcoming && (
            <span className="truncate text-[11px] text-muted">
              <span className="sr-only">Top performer: </span>★ {side.top.name} <span className="font-semibold tabular-nums text-ink/80">{side.top.points.toFixed(1)}</span>
            </span>
          )}
        </div>
      </div>
      <div className="text-right">
        <div key={flashKey} className={cn("rounded px-1 font-display text-2xl font-extrabold leading-none tabular-nums", flashKey && "animate-flash", upcoming ? "text-muted/80" : leading ? "text-ink" : "text-ink/70")}>
          {upcoming ? fmtScore(side.projected, 1) : fmtScore(side.score)}
        </div>
        <div className="mt-0.5 text-[11px] tabular-nums text-muted">
          {upcoming ? (
            "Projected"
          ) : (
            <>
              {status === "FINAL" ? "Proj" : "Live proj"} <span className="font-semibold text-ink/80">{fmtScore(side.projected, 1)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Counts({ side }: { side: CardSide }) {
  return (
    <span className="tabular-nums">
      <span title="Yet to play">{side.yetToPlay} YTP</span>
      <span className="mx-1 text-line">|</span>
      <span title="In progress" className={side.inProgress ? "font-semibold text-live" : undefined}>
        {side.inProgress} IP
      </span>
    </span>
  );
}

function MatchupCard({ card: c, flashKey }: { card: LiveCard; flashKey: number }) {
  const final = c.status === "FINAL";
  // the bar shows a result only once the whole game is decided
  const decided = c.game ? c.game.status === "FINAL" : final;
  const away = c.away;
  const home = c.home;
  return (
    <Link
      href={`/scoring/${c.id}`}
      className={cn(
        "group block overflow-hidden rounded-lg border bg-panel shadow-panel transition-colors hover:border-brand-300 dark:hover:border-brand-700",
        c.isMine ? "border-gold-400/70 ring-1 ring-gold-400/40" : "border-line",
        c.status === "LIVE" && "border-l-4 border-l-live",
      )}
      aria-label={`${away?.team.name ?? "Bye"} vs ${home?.team.name ?? "Bye"} — open matchup`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-sunken/60 px-3 py-1.5">
        <MatchupStatus status={c.status} label={c.label} />
        <span className="flex items-center gap-2">
          {c.isMine && <span className="rounded bg-gold-500 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-brand-950">My matchup</span>}
          <ChevronRight size={14} className="text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
      <div className="space-y-2.5 p-3">
        {away ? <SideRow side={away} other={home} status={c.status} flashKey={flashKey} /> : <div className="text-sm text-muted">Bye</div>}
        {home ? <SideRow side={home} other={away} status={c.status} flashKey={flashKey} /> : <div className="text-sm text-muted">Bye</div>}
        {c.game && home && away && <PlayoffGameLine game={c.game} sides={{ homeId: home.team.id, homeName: home.team.name, awayName: away.team.name }} />}
      </div>
      {home && away && (
        <div className="border-t border-line px-3 pb-2.5 pt-2">
          <WinProbBar
            leftProb={1 - c.homeWinProb}
            leftColor={away.team.primaryColor}
            rightColor={home.team.primaryColor}
            leftLabel={away.team.abbrev}
            rightLabel={home.team.abbrev}
            final={decided}
            caption={c.game ? (decided ? "Game result" : "Game win prob") : undefined}
            size="sm"
          />
          {!final && (
            <div className="mt-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted">
              <Counts side={away} />
              <span>Players left</span>
              <Counts side={home} />
            </div>
          )}
        </div>
      )}
    </Link>
  );
}
