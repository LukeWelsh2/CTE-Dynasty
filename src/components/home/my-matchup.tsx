"use client";
// "My Matchup" card: both teams, live score + live projection, win probability, players yet to play.
// score.update events patch the card instantly; a throttled fetch of /api/live/matchup/:id refreshes the
// players-left counts, and scores.refresh triggers a throttled router.refresh().
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import { Badge, Collapsible, CompareBar, EmptyState, GameStatus, Panel, TeamLogo } from "@/components/ui/core";
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
  const upcoming = status === "UPCOMING";
  const dim = !upcoming && !winning;
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col gap-2", right && "items-end text-right")}>
      <TeamLogo team={side.team} size={40} />
      <div className="min-w-0 max-w-full">
        <Link href={`/teams/${side.team.id}`} title={side.team.name} className="line-clamp-2 break-words text-[15px] font-semibold leading-5 text-ink hover:underline">
          {side.team.name}
        </Link>
        <div className="mt-0.5 truncate text-[13px] leading-[18px] text-muted">
          {side.seed ? `#${side.seed} · ` : ""}
          {side.record ?? ""}
          {side.ownerName ? ` · ${side.ownerName}` : ""}
        </div>
      </div>
      {/* pinned to the bottom of the (equal-height) side so both scores share a baseline when one name wraps */}
      <div className={cn("mt-auto", right && "text-right")}>
        {upcoming ? (
          <>
            <div className="eyebrow">Proj</div>
            <LiveNumber value={side.projected} decimals={1} className="text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[48px]" />
          </>
        ) : (
          <>
            <LiveNumber value={side.score} decimals={decimals} className={cn("text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[48px]", dim ? "text-muted" : "text-ink")} />
            <div className="text-[13px] text-muted">
              {status === "FINAL" ? "Proj was" : "Proj"} <span className="numeral font-semibold text-ink">{side.projected.toFixed(1)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Behind a tap: each side's top player and the starters still to play (with kickoff times). */
function PlayersLeft({ side, status, decimals, timezone, align }: { side: MatchupSide; status: string; decimals: number; timezone: string; align: "left" | "right" }) {
  const right = align === "right";
  return (
    <div className={cn("min-w-0 space-y-2", right && "text-right")}>
      <div className="truncate text-[13px] font-semibold text-ink" title={side.team.name}>
        {side.team.abbrev}
      </div>
      {side.top && (status === "UPCOMING" || side.top.points !== 0) && (
        <p className="truncate text-[13px] text-muted">
          {status === "UPCOMING" ? "Top proj " : "Top "}
          <Link href={`/players/${side.top.id}`} className="font-semibold text-ink hover:text-brand-600 hover:underline dark:hover:text-brand-400">
            {shortPlayerName(side.top.name)}
          </Link>{" "}
          <span className="numeral">{status === "UPCOMING" ? side.top.projected.toFixed(1) : side.top.points.toFixed(decimals)}</span>
        </p>
      )}
      {side.pending.length > 0 && status !== "FINAL" ? (
        <ul className={cn("flex flex-wrap gap-1", right && "justify-end")} aria-label={`${side.team.name} players yet to play`}>
          {side.pending.map((p) => (
            <li
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[12px]"
              title={p.kickoff ? `${p.name} · kickoff ${formatWhen(p.kickoff, timezone, new Date())}` : p.name}
              suppressHydrationWarning
            >
              <span className="font-semibold text-ink">{shortPlayerName(p.name)}</span>
              <span className="text-muted">{p.position}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">{status === "FINAL" ? "All done" : "No one left to play"}</p>
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
        "rounded-lg px-3 py-2 text-center text-[14px] font-semibold",
        decided ? (won ? "bg-win/10 text-win" : "bg-loss/10 text-loss") : "bg-sunken text-ink",
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
  const [myColor, oppColor] = opp ? contrastPair(me.team, opp.team) : [me.team.primaryColor, "#c3c8d0"];
  const diff = opp ? me.score - opp.score : 0;
  const game = m.game ?? null;
  // a week of a multi-week game shows the game's result, and only once the whole game is decided
  const final = game ? game.status === "FINAL" : m.status === "FINAL";
  const iWon = final && (m.winnerTeamId ? m.winnerTeamId === me.team.id : diff > 0);
  const tied = final && !m.winnerTeamId && Math.abs(diff) < 0.005;

  if (!opp) {
    return (
      <div className="flex items-center gap-3">
        <TeamLogo team={me.team} size={40} />
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{me.team.name}</div>
          <p className="text-[13px] text-muted">{m.isPlayoff ? "First-round bye · you advance" : "Bye week"}</p>
        </div>
      </div>
    );
  }
  const live = m.status === "LIVE";
  const meDone = Math.max(0, me.starters - me.yetToPlay - me.inProgress);
  const oppDone = Math.max(0, opp.starters - opp.yetToPlay - opp.inProgress);
  return (
    <div className="space-y-4">
      {game ? (
        <GameBanner m={m} game={game} />
      ) : (
        final && (
          <div className={cn("rounded-lg px-3 py-2 text-center text-[14px] font-semibold", tied ? "bg-sunken text-ink" : iWon ? "bg-win/10 text-win" : "bg-loss/10 text-loss")}>
            {tied ? "Tie game" : iWon ? `Won by ${Math.abs(diff).toFixed(m.decimals)}` : `Lost by ${Math.abs(diff).toFixed(m.decimals)}`}
          </div>
        )
      )}
      <div className="flex items-stretch gap-3 sm:gap-6">
        <SideBlock side={me} align="left" winning={me.score >= opp.score} status={m.status} decimals={m.decimals} />
        <SideBlock side={opp} align="right" winning={opp.score >= me.score} status={m.status} decimals={m.decimals} />
      </div>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="numeral text-[15px] font-semibold text-ink">{pctLabel(myWin)}</span>
          <span className="eyebrow truncate">{final ? "Result" : game ? "Game win %" : "Win probability"}</span>
          <span className="numeral text-[15px] font-semibold text-ink">{pctLabel(1 - myWin)}</span>
        </div>
        <WinProbBar left={myWin} leftColor={myColor} rightColor={oppColor} size="sm" label={`${me.team.name} win probability ${pctLabel(myWin)}`} />
      </div>
      <div className="divide-y divide-line/70 border-t border-line/70">
        <CompareBar label="Yet to play" left={me.yetToPlay} right={opp.yetToPlay} decimals={0} leftColor={myColor} rightColor={oppColor} />
        {m.status !== "UPCOMING" && (
          <>
            {live && <CompareBar label="Playing" left={me.inProgress} right={opp.inProgress} decimals={0} leftColor={myColor} rightColor={oppColor} />}
            <CompareBar label="Done" left={meDone} right={oppDone} decimals={0} leftColor={myColor} rightColor={oppColor} />
          </>
        )}
        <Collapsible summary="Players left" meta={`${me.yetToPlay + me.inProgress} · ${opp.yetToPlay + opp.inProgress}`} className="-mb-1">
          <div className="grid grid-cols-2 gap-3">
            <PlayersLeft side={me} status={m.status} decimals={m.decimals} timezone={timezone} align="left" />
            <PlayersLeft side={opp} status={m.status} decimals={m.decimals} timezone={timezone} align="right" />
          </div>
        </Collapsible>
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

  const title = `Week ${matchup?.week ?? data.week} matchup`;

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
      actions={
        matchup ? (
          <div className="flex items-center gap-2">
            {matchup.label && <Badge tone={matchup.isPlayoff ? "gold" : "neutral"}>{matchup.label}</Badge>}
            {matchup.status === "UPCOMING" ? null : <GameStatus status={matchup.status} />}
            <MoreLink href={`/scoring/${matchup.id}`}>Box score</MoreLink>
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
            <Link href="/playoffs" className="link">
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
      {data.nextUp && (
        <div className="mt-2 border-t border-line/70 pt-2 text-[13px]">
          <Link href={`/scoring/${data.nextUp.matchupId}`} className="-my-1 inline-flex min-h-10 min-w-0 max-w-full items-center gap-1.5 font-semibold text-ink hover:underline">
            <span className="shrink-0 text-muted">Next · Wk {data.nextUp.week}</span>
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
        </div>
      )}
    </Panel>
  );
}
