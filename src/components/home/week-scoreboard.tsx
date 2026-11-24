"use client";
// Every matchup this week as MatchupRows (mine first, three shown, the rest behind "Show all"). score.update events
// patch rows in place with a flash.
import Link from "next/link";
import { useState } from "react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoreUpdateEvent, ScoresRefreshEvent } from "@/lib/realtime/events";
import { LiveDot, MatchupRow, Panel, TeamLogo, type MatchupRowSide } from "@/components/ui/core";
import { ShowMore } from "@/components/ui/client";
import { cn } from "@/lib/utils";
import { MoreLink, PanelEmpty } from "./bits";
import type { ScoreboardData, ScoreboardSide, ScoreboardTile } from "./types";
import { useThrottledRefresh } from "./use-throttled-refresh";
import { gameStateShort, patchGameWeek, type PlayoffGameContext } from "@/components/scoring/playoff-game";

/** `game`: a week of a multi-week playoff game (combined score; homeWinProb is then for the whole game). */
type Tile = ScoreboardTile & { game?: PlayoffGameContext | null };
type Data = Omit<ScoreboardData, "tiles"> & { tiles: Tile[] };

/** The tile names a winner only once the game is over (a multi-week game: all of its weeks). */
const isDecided = (tile: Tile) => (tile.game ? tile.game.status === "FINAL" : tile.status === "FINAL");

function TileRow({ tile, decimals, myTeamId, flashKey }: { tile: Tile; decimals: number; myTeamId: string | null; flashKey: number }) {
  const mine = tile.home?.team.id === myTeamId || tile.away?.team.id === myTeamId;
  const final = isDecided(tile);
  const both = tile.home && tile.away;
  const side = (s: ScoreboardSide | null): MatchupRowSide | null => (s ? { team: s.team, score: s.score, projected: s.projected, record: s.record } : null);
  return (
    <li key={flashKey} className={cn(flashKey > 0 && "animate-flash")}>
      <MatchupRow
        href={`/scoring/${tile.id}`}
        away={side(tile.away)}
        home={side(tile.home)}
        status={tile.status}
        homeWinProb={both && !final ? tile.homeWinProb : null}
        winnerTeamId={final ? tile.winnerTeamId : null}
        label={tile.label}
        mine={mine}
        myTeamId={myTeamId}
        decimals={decimals}
        logo={(t) => <TeamLogo team={t} size={24} />}
        note={
          tile.game && both
            ? gameStateShort(tile.game, { homeId: tile.home!.team.id, home: tile.home!.team.abbrev, away: tile.away!.team.abbrev }, Math.min(1, decimals))
            : undefined
        }
      />
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
          Week {data.week} scoreboard {anyLive && <LiveDot />}
        </span>
      }
      className={className}
      noPad
      actions={<MoreLink href={`/scoring`}>All</MoreLink>}
    >
      {sorted.length ? (
        <div className="border-t border-line/70">
          <ShowMore as="ul" initial={3} className="divide-y divide-line/70" moreLabel={`Show all ${sorted.length} matchups`}>
            {sorted.map((t) => (
              <TileRow key={t.id} tile={t} decimals={data.decimals} myTeamId={myTeamId} flashKey={flash[t.id] ?? 0} />
            ))}
          </ShowMore>
        </div>
      ) : (
        <div className="px-4 pb-4">
          <PanelEmpty action={<MoreLink href="/schedule">Season schedule</MoreLink>}>No matchups are scheduled for Week {data.week}.</PanelEmpty>
        </div>
      )}
    </Panel>
  );
}
