"use client";
// Compact grid of every matchup this week. score.update events patch tiles in place with a flash.
import Link from "next/link";
import { useState } from "react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import { LiveDot, Panel, TeamLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { contrastPair, MoreLink, PanelEmpty, WinProbBar } from "./bits";
import { pctLabel } from "./logic";
import type { ScoreboardData, ScoreboardSide, ScoreboardTile } from "./types";
import { useThrottledRefresh } from "./use-throttled-refresh";
import { gameStateShort, patchGameWeek, type PlayoffGameContext } from "@/components/scoring/playoff-game";

/** `game`: a week of a multi-week playoff game (combined score; homeWinProb is then for the whole game). */
type Tile = ScoreboardTile & { game?: PlayoffGameContext | null };
type Data = Omit<ScoreboardData, "tiles"> & { tiles: Tile[] };

/** The tile names a winner only once the game is over (a multi-week game: all of its weeks). */
const isDecided = (tile: Tile) => (tile.game ? tile.game.status === "FINAL" : tile.status === "FINAL");

function TeamRow({ side, other, tile, decimals, myTeamId }: { side: ScoreboardSide | null; other: ScoreboardSide | null; tile: Tile; decimals: number; myTeamId: string | null }) {
  if (!side) return <div className="flex h-6 items-center text-xs font-semibold text-muted">BYE</div>;
  const upcoming = tile.status === "UPCOMING";
  const final = isDecided(tile);
  const winning = final ? tile.winnerTeamId === side.team.id || (!tile.winnerTeamId && !!other && side.score > other.score) : !!other && side.score > other.score;
  return (
    <div className="flex h-6 items-center gap-2 text-sm">
      <TeamLogo team={side.team} size={18} />
      <span className={cn("min-w-0 flex-1 truncate font-semibold", side.team.id === myTeamId ? "text-brand-700 dark:text-brand-300" : "text-ink", final && !winning && "text-ink/60")}>
        <span className="sm:hidden">{side.team.abbrev}</span>
        <span className="hidden sm:inline">{side.team.name}</span>
        {side.record && <span className="ml-1.5 text-[10px] font-normal text-muted">{side.record}</span>}
      </span>
      {upcoming ? (
        <span className="text-xs tabular-nums text-muted" title="Projected">
          {side.projected.toFixed(1)}
        </span>
      ) : (
        <span className={cn("tabular-nums", winning ? "font-extrabold text-ink" : "font-semibold text-ink/70")}>{side.score.toFixed(decimals)}</span>
      )}
    </div>
  );
}

function TileCard({ tile, decimals, myTeamId, flashKey }: { tile: Tile; decimals: number; myTeamId: string | null; flashKey: number }) {
  const mine = tile.home?.team.id === myTeamId || tile.away?.team.id === myTeamId;
  const live = tile.status === "LIVE";
  const weekFinal = tile.status === "FINAL";
  const final = isDecided(tile);
  const both = tile.home && tile.away;
  const [awayColor, homeColor] = both ? contrastPair(tile.away!.team, tile.home!.team) : ["#94a3b8", "#94a3b8"];
  const fav = both ? (tile.homeWinProb >= 0.5 ? tile.home! : tile.away!) : null;
  return (
    <li key={flashKey} className={cn(flashKey > 0 && "animate-flash", "rounded-md")}>
      <Link
        href={`/scoring/${tile.id}`}
        className={cn(
          "block rounded-md border bg-panel px-2.5 py-2 transition-colors hover:border-brand-300 hover:bg-sunken/60 dark:hover:border-brand-700",
          mine ? "border-gold-400/70 bg-gold-300/10" : "border-line",
        )}
        aria-label={both ? `${tile.away!.team.name} vs ${tile.home!.team.name}` : "Matchup"}
      >
        <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider">
          <span className={cn("flex items-center gap-1 truncate", live ? "text-live" : "text-muted")}>
            {live && <LiveDot />}
            {live ? "Live" : weekFinal ? "Final" : tile.label ?? "Upcoming"}
            {(live || weekFinal) && tile.label ? <span className="truncate text-muted">· {tile.label}</span> : null}
          </span>
          {fav && !final && (
            <span className="shrink-0 text-muted">
              {pctLabel(Math.max(tile.homeWinProb, 1 - tile.homeWinProb))} {fav.team.abbrev}
            </span>
          )}
        </div>
        <TeamRow side={tile.away} other={tile.home} tile={tile} decimals={decimals} myTeamId={myTeamId} />
        <TeamRow side={tile.home} other={tile.away} tile={tile} decimals={decimals} myTeamId={myTeamId} />
        {tile.game && both && (
          <p className={cn("mt-1 truncate text-[10px] font-semibold", final ? "text-ink" : "text-muted")}>
            {gameStateShort(tile.game, { homeId: tile.home!.team.id, home: tile.home!.team.abbrev, away: tile.away!.team.abbrev }, Math.min(1, decimals))}
          </p>
        )}
        {both && !final && <WinProbBar left={1 - tile.homeWinProb} leftColor={awayColor} rightColor={homeColor} className="mt-1.5 h-1" label={`${tile.away!.team.name} ${tile.game ? "game " : ""}win probability`} />}
      </Link>
    </li>
  );
}

export function WeekScoreboard({ data, leagueId, myTeamId, className }: { data: Data; leagueId: string; myTeamId: string | null; className?: string }) {
  const [tiles, setTiles] = useState(data.tiles);
  const [seen, setSeen] = useState(data.tiles);
  const [flash, setFlash] = useState<Record<string, number>>({});
  if (seen !== data.tiles) {
    setSeen(data.tiles);
    setTiles(data.tiles);
  }
  const refresh = useThrottledRefresh(30_000);

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type === "score.update") {
      const u = e.data as ScoreUpdateEvent;
      if (u.week !== data.week) return;
      setTiles((ts) =>
        ts.map((t) =>
          t.id === u.matchupId
            ? {
                ...t,
                status: u.status,
                // stored odds (and so the event's) are whole-game odds for a week of a multi-week playoff game
                homeWinProb: u.homeWinProb,
                game: t.game ? patchGameWeek(t.game, t.id, u.homeScore, u.awayScore, u.status) : t.game,
                home: t.home ? { ...t.home, score: u.homeScore, projected: u.homeProjected } : null,
                away: t.away ? { ...t.away, score: u.awayScore, projected: u.awayProjected } : null,
              }
            : t,
        ),
      );
      setFlash((f) => ({ ...f, [u.matchupId]: Date.now() }));
    } else if (e.type === "scores.refresh") {
      if ((e.data as ScoresRefreshEvent).week === data.week) refresh(true);
    }
  });

  const sorted = [...tiles].sort((a, b) => {
    const mine = (t: Tile) => (t.home?.team.id === myTeamId || t.away?.team.id === myTeamId ? 0 : 1);
    return mine(a) - mine(b);
  });
  const anyLive = tiles.some((t) => t.status === "LIVE");

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          Week {data.week} Scoreboard {anyLive && <LiveDot />}
        </span>
      }
      className={className}
      actions={<MoreLink href={`/scoring`}>Full scoreboard</MoreLink>}
    >
      {sorted.length ? (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {sorted.map((t) => (
            <TileCard key={t.id} tile={t} decimals={data.decimals} myTeamId={myTeamId} flashKey={flash[t.id] ?? 0} />
          ))}
        </ul>
      ) : (
        <PanelEmpty action={<MoreLink href="/schedule">Season schedule</MoreLink>}>No matchups are scheduled for Week {data.week}.</PanelEmpty>
      )}
    </Panel>
  );
}
