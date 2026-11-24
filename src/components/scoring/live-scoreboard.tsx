"use client";
// League scoreboard (docs/DESIGN.md §5 "A matchup", §6.1 type roles): every matchup of the week as one row in a
// single card — two team lines (logo · name · one grey subline · score in the condensed scoreboard numerals with the
// projection under it · win %), my matchup first with the blue edge. score.update patches rows in place with a flash;
// scores.refresh / structural changes trigger a throttled router.refresh().
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import type { CardSide, ScoreboardCard } from "@/lib/live/types";
import { wpPercent } from "@/lib/live/format";
import { LiveDot, ResultPill, TeamLogo } from "@/components/ui/core";
import { fmtPoints } from "@/components/ui/fantasy";
import { cn } from "@/lib/utils";
import { gameStateShort, patchGameWeek, type PlayoffGameContext } from "./playoff-game";

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

  const allUpcoming = cards.every((c) => c.status === "UPCOMING");
  return (
    <section aria-label={`Week ${week} matchups`} className="card overflow-hidden">
      {/* column heads: what the two numbers on each team line are */}
      <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_4rem_3rem] items-center gap-x-2.5 border-b border-line/70 px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-muted">
        <span>Matchup</span>
        <span className="text-right">{allUpcoming ? "Proj" : "Pts"}</span>
        <span className="text-right">Win</span>
      </div>
      <ul className="divide-y divide-line/70">
        {cards.map((c) => (
          <MatchupItem key={c.id} card={c} flashKey={flash[c.id] ?? 0} />
        ))}
      </ul>
    </section>
  );
}

/** Who won a final card: the decided playoff game, else the stored odds (1 / 0 once final), else the scores. */
function finalWinnerId(c: LiveCard): string | null {
  if (!c.home || !c.away) return null;
  if (c.game) return c.game.status === "FINAL" ? c.game.winnerTeamId ?? null : null;
  if (c.homeWinProb >= 0.999) return c.home.team.id;
  if (c.homeWinProb <= 0.001) return c.away.team.id;
  return c.home.score === c.away.score ? null : c.home.score > c.away.score ? c.home.team.id : c.away.team.id;
}

function MatchupItem({ card: c, flashKey }: { card: LiveCard; flashKey: number }) {
  const live = c.status === "LIVE";
  const final = c.status === "FINAL";
  // a week of a multi-week playoff game names a result only once the whole game is decided
  const decided = c.game ? c.game.status === "FINAL" : final;
  const away = c.away;
  const home = c.home;
  const both = !!(away && home);
  const winnerId = decided ? finalWinnerId(c) : null;
  const leaderId = !both ? null : decided ? winnerId : away!.score === home!.score ? null : away!.score > home!.score ? away!.team.id : home!.team.id;
  const note =
    c.game && both ? gameStateShort(c.game, { homeId: home!.team.id, home: home!.team.abbrev, away: away!.team.abbrev }, 1) : null;
  const showTop = live || c.label || note;
  return (
    <li key={flashKey} className={cn(flashKey > 0 && "animate-flash")}>
      <Link
        href={`/scoring/${c.id}`}
        aria-label={`${away?.team.name ?? "Bye"} vs ${home?.team.name ?? "Bye"}${c.isMine ? " (my matchup)" : ""} — open matchup`}
        className={cn(
          "group relative block px-4 py-3 transition-colors hover:bg-sunken/70 active:bg-sunken",
          c.isMine && "bg-brand-600/[0.04] shadow-[inset_3px_0_0_rgb(var(--c-accent))] dark:bg-brand-400/[0.07]",
        )}
      >
        {showTop && (
          <span className="mb-1.5 flex min-w-0 items-center gap-2 text-[12px] font-semibold uppercase leading-4 tracking-[0.04em]">
            {live && (
              <span className="inline-flex shrink-0 items-center gap-1 text-live">
                <LiveDot className="h-1.5 w-1.5" /> Live
              </span>
            )}
            {c.label && <span className="truncate text-muted">{c.label}</span>}
          </span>
        )}
        <span className="block space-y-2">
          {away ? <TeamLine side={away} status={c.status} decided={decided} leaderId={leaderId} winnerId={winnerId} winProb={both ? 1 - c.homeWinProb : null} /> : <ByeLine />}
          {home ? <TeamLine side={home} status={c.status} decided={decided} leaderId={leaderId} winnerId={winnerId} winProb={both ? c.homeWinProb : null} /> : <ByeLine />}
        </span>
        {note && <span className={cn("mt-2 block truncate text-[12px]", c.game?.status === "FINAL" ? "font-semibold text-ink" : "text-muted")}>{note}</span>}
        <ChevronRight size={16} aria-hidden className="absolute right-1 top-1/2 hidden -translate-y-1/2 text-faint transition-transform group-hover:translate-x-0.5 sm:block" />
      </Link>
    </li>
  );
}

function ByeLine() {
  return <span className="flex h-10 items-center pl-[38px] text-[13px] font-semibold text-muted">Bye</span>;
}

/** "J. Allen" for a subline */
function short(name: string) {
  const parts = name.split(/\s+/);
  return parts.length < 2 ? name : `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

function TeamLine({
  side,
  status,
  decided,
  leaderId,
  winnerId,
  winProb,
}: {
  side: CardSide;
  status: string;
  decided: boolean;
  leaderId: string | null;
  winnerId: string | null;
  /** this side's chance to win (null on a bye) */
  winProb: number | null;
}) {
  const upcoming = status === "UPCOMING";
  const live = status === "LIVE";
  const lead = leaderId === side.team.id;
  const trailing = !upcoming && leaderId !== null && !lead;
  const pct = winProb === null ? null : wpPercent(winProb, decided);
  // subline: record (+ seed) before kickoff; players to play / playing while live; the top performer once started
  const facts: React.ReactNode[] = [];
  if (side.seed) facts.push(`#${side.seed}`);
  facts.push(side.team.record);
  if (live) {
    facts.push(`${side.yetToPlay} to play`);
    if (side.inProgress) facts.push(<span className="font-semibold text-live">{side.inProgress} playing</span>);
  }
  if (!upcoming && side.top) facts.push(<span title={`Top performer: ${side.top.name}`}>★ {short(side.top.name)} {fmtPoints(side.top.points)}</span>);
  return (
    <span className="grid grid-cols-[28px_minmax(0,1fr)_4rem_3rem] items-center gap-x-2.5">
      <TeamLogo team={side.team} size={28} />
      <span className="min-w-0">
        <span title={side.team.name} className={cn("block truncate text-[15px] font-semibold leading-5", trailing ? "text-muted" : "text-ink")}>
          {side.team.name}
        </span>
        <span className="block truncate text-[12px] leading-4 text-muted sm:text-[13px]">
          {facts.map((f, i) => (
            <span key={i}>
              {i > 0 && " · "}
              {f}
            </span>
          ))}
        </span>
      </span>
      <span className="text-right">
        {upcoming ? (
          <span className="numeral block font-score text-[24px] font-bold leading-6 text-muted" title="Projected">
            {side.projected.toFixed(1)}
          </span>
        ) : (
          <>
            <span className={cn("numeral block font-score text-[24px] font-bold leading-6", trailing ? "text-muted" : "text-ink")}>{fmtPoints(side.score)}</span>
            <span className="numeral block text-[12px] leading-4 text-muted" title={decided ? "Projected before kickoff" : "Live projection"}>
              {side.projected.toFixed(1)}
            </span>
          </>
        )}
      </span>
      <span className="text-right">
        {decided ? (
          winnerId ? (
            <ResultPill result={winnerId === side.team.id ? "W" : "L"} />
          ) : (
            <ResultPill result="T" />
          )
        ) : pct !== null ? (
          <span className={cn("numeral text-[15px] font-semibold", pct > 50 ? "text-win" : pct < 50 ? "text-muted" : "text-ink")} title="Win probability">
            {pct}%
          </span>
        ) : null}
      </span>
    </span>
  );
}
