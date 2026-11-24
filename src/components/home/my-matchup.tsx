"use client";
// "My Matchup" card: both teams, live score + live projection, win probability, players yet to play.
// score.update events patch the card instantly; a throttled fetch of /api/live/matchup/:id refreshes the
// players-left counts, and scores.refresh triggers a throttled router.refresh().
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Clock } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import { Badge, EmptyState, GameStatus, Panel, TeamLogo } from "@/components/ui/core";
import { LiveNumber } from "@/components/ui/client";
import { cn } from "@/lib/utils";
import { contrastPair, MoreLink, WinProbBar } from "./bits";
import { formatWhen, liveStarterSummary, pctLabel, shortPlayerName, type LiveMatchupPlayer } from "./logic";
import type { MatchupModule, MatchupSide, MyMatchupData } from "./types";
import { useThrottledRefresh } from "./use-throttled-refresh";
import { gameStateText, legLabel, patchGameWeek, type PlayoffGameContext } from "@/components/scoring/playoff-game";

/** `game`: a week of a multi-week playoff game (combined score; homeWinProb is then for the whole game). */
type MyMatchup = MyMatchupData & { game?: PlayoffGameContext | null };
type MatchupData = Omit<MatchupModule, "matchup"> & { matchup: MyMatchup | null };

interface LiveSide {
  teamId: string;
  yetToPlay: number;
  inProgress: number;
  players: LiveMatchupPlayer[];
}

function applyLiveSide(side: MatchupSide, live: LiveSide | null | undefined, status: string): MatchupSide {
  if (!live || live.teamId !== side.team.id) return side;
  const { pendingIds: stillPending, top: best } = liveStarterSummary(live.players);
  const top =
    status === "UPCOMING"
      ? side.top
      : best
        ? {
            id: best.playerId,
            name: best.name,
            position: side.top?.id === best.playerId ? side.top.position : "",
            nflTeam: null,
            points: best.points,
            projected: best.projected,
            kickoff: null,
          }
        : null;
  return { ...side, yetToPlay: live.yetToPlay, inProgress: live.inProgress, top, pending: side.pending.filter((p) => stillPending.has(p.id)) };
}

function SideBlock({ side, align, winning, status, decimals }: { side: MatchupSide; align: "left" | "right"; winning: boolean; status: string; decimals: number }) {
  const right = align === "right";
  const dim = status !== "UPCOMING" && !winning;
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-2.5", right && "items-end text-right")}>
      {/* phones: logo above the name so the name gets the side's full width (two lines before truncating) */}
      <div className={cn("flex min-w-0 max-w-full flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3", right ? "items-end sm:flex-row-reverse" : "items-start")}>
        <TeamLogo team={side.team} size={48} className="hidden sm:inline-flex" />
        <TeamLogo team={side.team} size={36} className="sm:hidden" />
        <div className="min-w-0 max-w-full">
          <Link
            href={`/teams/${side.team.id}`}
            title={side.team.name}
            className="line-clamp-2 break-words font-display text-[17px] font-bold uppercase leading-[1.1] tracking-[0.03em] text-ink hover:underline sm:text-lg"
          >
            {side.team.name}
          </Link>
          <div className="mt-0.5 truncate text-xs text-muted">
            {side.seed ? `#${side.seed} seed · ` : ""}
            {side.record ?? ""}
            {side.ownerName ? ` · ${side.ownerName}` : ""}
          </div>
        </div>
      </div>
      {/* pinned to the bottom of the (equal-height) side so both scores share a baseline when one name wraps */}
      <div className={cn("mt-auto flex flex-col gap-2.5", right && "items-end")}>
        <LiveNumber value={side.score} decimals={decimals} className={cn("text-[44px] font-semibold leading-[0.9] tracking-[-0.035em] sm:text-[56px]", dim ? "text-ink/40" : "text-ink")} />
        <div className="text-xs text-muted">
          {status === "FINAL" ? "Final" : "Proj"} <span className="numeral font-semibold text-ink">{side.projected.toFixed(1)}</span>
        </div>
      </div>
    </div>
  );
}

function PlayersLeft({ side, status, decimals, timezone, align }: { side: MatchupSide; status: string; decimals: number; timezone: string; align: "left" | "right" }) {
  const done = Math.max(0, side.starters - side.yetToPlay - side.inProgress);
  const right = align === "right";
  return (
    <div className={cn("min-w-0 space-y-1.5", right && "text-right")}>
      <div className={cn("flex flex-wrap gap-x-3 gap-y-0.5 text-xs", right && "justify-end")}>
        <span>
          <span className="numeral font-semibold text-ink">{side.yetToPlay}</span> <span className="text-muted">yet to play</span>
        </span>
        {status !== "UPCOMING" && (
          <>
            <span>
              <span className="numeral font-semibold text-live">{side.inProgress}</span> <span className="text-muted">playing</span>
            </span>
            <span>
              <span className="numeral font-semibold text-ink">{done}</span> <span className="text-muted">done</span>
            </span>
          </>
        )}
      </div>
      {side.top && (status === "UPCOMING" || side.top.points !== 0) && (
        <p className="truncate text-xs text-muted">
          {status === "UPCOMING" ? "Top projected: " : "Top scorer: "}
          <Link href={`/players/${side.top.id}`} className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
            {side.top.name}
          </Link>{" "}
          <span className="tabular-nums">{status === "UPCOMING" ? `${side.top.projected.toFixed(1)} proj` : `${side.top.points.toFixed(decimals)} pts`}</span>
        </p>
      )}
      {side.pending.length > 0 && status !== "FINAL" && (
        <ul className={cn("flex flex-wrap gap-1", right && "justify-end")} aria-label={`${side.team.name} players yet to play`}>
          {side.pending.slice(0, 6).map((p) => (
            <li
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11px] ring-1 ring-inset ring-line/70"
              title={p.kickoff ? `${p.name} · kickoff ${formatWhen(p.kickoff, timezone, new Date())}` : p.name}
              suppressHydrationWarning
            >
              <span className="font-semibold text-ink">{shortPlayerName(p.name)}</span>
              <span className="text-muted">{p.position}</span>
              {p.kickoff && (
                <span className="hidden text-muted sm:inline" suppressHydrationWarning>
                  · {formatWhen(p.kickoff, timezone, new Date())}
                </span>
              )}
            </li>
          ))}
          {side.pending.length > 6 && <li className="px-1 text-[11px] text-muted">+{side.pending.length - 6} more</li>}
        </ul>
      )}
    </div>
  );
}

/** Result banner for a week of a multi-week playoff game: the game's result once decided, the standing before that. */
function GameBanner({ m, game }: { m: MyMatchup; game: PlayoffGameContext }) {
  const me = m.me;
  const opp = m.opponent!;
  const f = (n: number) => n.toFixed(m.decimals);
  const [mine, theirs] = m.myIsHome ? [game.homeTotal, game.awayTotal] : [game.awayTotal, game.homeTotal];
  const homeName = m.myIsHome ? me.team.name : opp.team.name;
  const awayName = m.myIsHome ? opp.team.name : me.team.name;
  const decided = game.status === "FINAL" && !!game.winnerTeamId;
  const won = decided && game.winnerTeamId === me.team.id;
  const weekFinal = m.status === "FINAL";
  let text: string;
  if (decided) text = mine === theirs ? `${won ? "You won" : "You lost"} the ${game.legs}-week game on the tiebreaker (${f(mine)}–${f(theirs)})` : `${won ? "You won" : "You lost"} the ${game.legs}-week game ${f(mine)}–${f(theirs)}`;
  else if (weekFinal) text = mine > theirs ? `You lead ${f(mine)}–${f(theirs)} after ${legLabel(game)}` : mine < theirs ? `You trail ${f(mine)}–${f(theirs)} after ${legLabel(game)}` : `Level at ${f(mine)} after ${legLabel(game)}`;
  else text = `${legLabel(game)} · ${gameStateText(game, { homeId: m.homeTeamId, homeName, awayName }, m.decimals)}`;
  return (
    <div
      className={cn(
        "rounded-full px-3 py-1.5 text-center text-sm font-semibold",
        decided ? (won ? "bg-win/10 text-green-800 dark:text-green-200" : "bg-loss/10 text-red-800 dark:text-red-200") : "bg-sunken text-ink",
      )}
    >
      {text}
    </div>
  );
}

function MatchupBody({ m, timezone }: { m: MyMatchup; timezone: string }) {
  const me = m.me;
  const opp = m.opponent;
  const myWin = m.myIsHome ? m.homeWinProb : 1 - m.homeWinProb;
  const [myColor, oppColor] = opp ? contrastPair(me.team, opp.team) : [me.team.primaryColor, "#94a3b8"];
  const diff = opp ? me.score - opp.score : 0;
  const game = m.game ?? null;
  // a week of a multi-week game shows the game's result, and only once the whole game is decided
  const final = game ? game.status === "FINAL" : m.status === "FINAL";
  const iWon = final && (m.winnerTeamId ? m.winnerTeamId === me.team.id : diff > 0);
  const tied = final && !m.winnerTeamId && Math.abs(diff) < 0.005;

  if (!opp) {
    return (
      <div className="flex items-center gap-3">
        <TeamLogo team={me.team} size={44} />
        <div>
          <div className="font-display text-lg font-bold uppercase tracking-wide">{me.team.name}</div>
          <p className="text-sm text-muted">{m.isPlayoff ? "First-round bye — you advance automatically." : "Bye week — no opponent this week."}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {game ? (
        <GameBanner m={m} game={game} />
      ) : (
        final && (
          <div className={cn("rounded-full px-3 py-1.5 text-center text-sm font-semibold", tied ? "bg-sunken text-ink" : iWon ? "bg-win/10 text-green-800 dark:text-green-200" : "bg-loss/10 text-red-800 dark:text-red-200")}>
            {tied ? "Tie game" : iWon ? `You won by ${Math.abs(diff).toFixed(m.decimals)}` : `You lost by ${Math.abs(diff).toFixed(m.decimals)}`}
          </div>
        )
      )}
      <div className="flex items-stretch gap-2 sm:gap-4">
        <SideBlock side={me} align="left" winning={me.score >= opp.score} status={m.status} decimals={m.decimals} />
        <div className="flex shrink-0 flex-col items-center self-start pt-2.5 sm:pt-3.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sunken font-display text-[11px] font-extrabold tracking-[0.04em] text-muted ring-1 ring-inset ring-line/70">VS</span>
        </div>
        <SideBlock side={opp} align="right" winning={opp.score >= me.score} status={m.status} decimals={m.decimals} />
      </div>
      <div>
        <div className="mb-1.5 flex items-end justify-between gap-2">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: myColor }} aria-hidden />
            <span className="numeral text-[15px] font-semibold text-ink">{pctLabel(myWin)}</span>
          </span>
          <span className="eyebrow truncate">{final ? "Result" : game ? "Game win probability" : "Win probability"}</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="numeral text-[15px] font-semibold text-ink">{pctLabel(1 - myWin)}</span>
            <span className="h-2 w-2 rounded-full" style={{ background: oppColor }} aria-hidden />
          </span>
        </div>
        <WinProbBar left={myWin} leftColor={myColor} rightColor={oppColor} size="md" label={`${me.team.name} win probability ${pctLabel(myWin)}`} />
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-line/70 pt-3">
        <PlayersLeft side={me} status={m.status} decimals={m.decimals} timezone={timezone} align="left" />
        <PlayersLeft side={opp} status={m.status} decimals={m.decimals} timezone={timezone} align="right" />
      </div>
    </div>
  );
}

export function MyMatchupCard({ data, leagueId, timezone, className }: { data: MatchupData; leagueId: string; timezone: string; className?: string }) {
  const [matchup, setMatchup] = useState(data.matchup);
  const [seen, setSeen] = useState(data.matchup);
  const [flash, setFlash] = useState(0);
  if (seen !== data.matchup) {
    setSeen(data.matchup);
    setMatchup(data.matchup);
  }
  const refresh = useThrottledRefresh(30_000);
  const lastFetch = useRef(0);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    },
    [],
  );

  const syncPlayersLeft = (id: string) => {
    if (fetchTimer.current) return;
    const wait = Math.max(0, lastFetch.current + 10_000 - Date.now());
    fetchTimer.current = setTimeout(async () => {
      fetchTimer.current = null;
      lastFetch.current = Date.now();
      try {
        const res = await fetch(`/api/live/matchup/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { home: LiveSide | null; away: LiveSide | null };
        setMatchup((cur) => {
          if (!cur || cur.id !== id) return cur;
          const homeLive = body.home;
          const awayLive = body.away;
          const pick = (side: MatchupSide | null) => (side ? applyLiveSide(side, side.team.id === homeLive?.teamId ? homeLive : awayLive, cur.status) : side);
          return { ...cur, me: pick(cur.me)!, opponent: pick(cur.opponent) };
        });
      } catch {
        // offline / transient: the next event or refresh catches up
      }
    }, wait);
  };

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type === "score.update") {
      const u = e.data as ScoreUpdateEvent;
      if (!matchup || u.matchupId !== matchup.id) return;
      setMatchup((cur) => {
        if (!cur) return cur;
        const homeIsMe = cur.myIsHome;
        const patch = (side: MatchupSide | null, isHome: boolean) => (side ? { ...side, score: isHome ? u.homeScore : u.awayScore, projected: isHome ? u.homeProjected : u.awayProjected } : side);
        // stored odds (and so the event's) are whole-game odds for a week of a multi-week playoff game
        const game = cur.game ? patchGameWeek(cur.game, cur.id, u.homeScore, u.awayScore, u.status) : cur.game;
        return { ...cur, status: u.status, homeWinProb: u.homeWinProb, game, me: patch(cur.me, homeIsMe)!, opponent: patch(cur.opponent, !homeIsMe) };
      });
      setFlash(Date.now());
      syncPlayersLeft(u.matchupId);
      if (u.status === "FINAL") refresh();
    } else if (e.type === "scores.refresh") {
      if ((e.data as ScoresRefreshEvent).week === data.week) refresh(true);
    }
  });

  const title = (
    <span className="flex items-center gap-2">
      My Matchup <span className="font-sans text-xs font-semibold normal-case tracking-normal text-muted">Week {matchup?.week ?? data.week}</span>
    </span>
  );

  if (!data.hasTeam) {
    return (
      <Panel title={title} className={className}>
        <EmptyState title="You don't manage a team in this league">Commissioner tools and every team's matchup are still available from the scoreboard.</EmptyState>
      </Panel>
    );
  }

  return (
    <Panel
      title={title}
      className={className}
      bodyClassName="p-3 sm:p-4"
      actions={
        matchup ? (
          <div className="flex items-center gap-2">
            {matchup.label && <Badge tone={matchup.isPlayoff ? "gold" : "purple"}>{matchup.label}</Badge>}
            <GameStatus status={matchup.status} />
            <MoreLink href={`/scoring/${matchup.id}`} className="hidden sm:inline-flex">
              Box score
            </MoreLink>
          </div>
        ) : undefined
      }
    >
      <div key={flash} className={cn("-m-1.5 rounded-xl p-1.5", flash > 0 && "animate-flash")}>
        {matchup ? (
          <MatchupBody m={matchup} timezone={timezone} />
        ) : data.phase === "PLAYOFFS" ? (
          <EmptyState title={`No playoff game in Week ${data.week}`} icon={<Clock size={22} aria-hidden />}>
            Your team has a bye or is out of the bracket this week.{" "}
            <Link href="/playoffs" className="font-semibold text-brand-700 hover:underline dark:text-brand-300">
              View the bracket
            </Link>
          </EmptyState>
        ) : data.phase === "OFFSEASON" || data.phase === "KEEPER" ? (
          <EmptyState title="The season is over" icon={<Clock size={22} aria-hidden />}>
            Matchups return when the new schedule is set.
          </EmptyState>
        ) : (
          <EmptyState title={`No matchup in Week ${data.week}`} icon={<Clock size={22} aria-hidden />}>
            Your team isn&apos;t scheduled this week.
          </EmptyState>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2.5 text-xs">
        {data.nextUp ? (
          <Link href={`/scoring/${data.nextUp.matchupId}`} className="-my-1.5 inline-flex min-h-8 min-w-0 items-center gap-1.5 font-semibold text-ink hover:underline">
            <span className="text-muted">Up next · Week {data.nextUp.week}</span>
            {data.nextUp.opponent ? (
              <>
                <span className="text-muted">vs</span>
                <TeamLogo team={data.nextUp.opponent} size={18} />
                <span className="truncate">{data.nextUp.opponent.name}</span>
              </>
            ) : (
              <span>Bye</span>
            )}
          </Link>
        ) : (
          <span />
        )}
        {matchup && (
          <Link href={`/scoring/${matchup.id}`} className="-my-1.5 ml-auto inline-flex min-h-8 items-center gap-1 font-semibold text-brand-700 hover:underline dark:text-brand-300">
            Live box score <ArrowRight size={13} aria-hidden />
          </Link>
        )}
      </div>
    </Panel>
  );
}
