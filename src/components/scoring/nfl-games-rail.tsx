"use client";
// NFL games this week: live scores, quarter/clock, possession, red zone, kickoff times, spread / O-U.
import { useState } from "react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { GameLite, NflGamesEvent } from "@/lib/live/types";
import { dateLabel } from "@/lib/live/format";
import { NflLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { GameStatusText } from "./bits";

export function NflGamesRail({ leagueId, season, week, tz, games: initial }: { leagueId: string; season: number; week: number; tz: string; games: GameLite[] }) {
  const [games, setGames] = useState(initial);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setGames(initial);
  }

  useLiveEvents([`league:${leagueId}`], (e) => {
    if (e.type !== "nfl.games") return;
    const d = e.data as NflGamesEvent;
    if (d.week !== week || d.season !== season) return;
    const byId = new Map(d.games.map((g) => [g.id, g]));
    const changed: Record<string, number> = {};
    for (const g of games) {
      const n = byId.get(g.id);
      if (n && (n.homeScore !== g.homeScore || n.awayScore !== g.awayScore)) changed[g.id] = Date.now();
    }
    setGames((cur) => cur.map((g) => byId.get(g.id) ?? g));
    if (Object.keys(changed).length) setFlash((f) => ({ ...f, ...changed }));
  });

  if (!games.length) return <p className="px-3 py-6 text-center text-sm text-muted">No NFL games scheduled this week.</p>;

  // group by kickoff day in the league timezone
  const groups: { day: string; games: GameLite[] }[] = [];
  for (const g of games) {
    const day = dateLabel(g.startTime, tz);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.games.push(g);
    else groups.push({ day, games: [g] });
  }

  return (
    <div className="divide-y divide-line">
      {groups.map((grp) => (
        <div key={grp.day}>
          <div className="bg-sunken/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted">{grp.day}</div>
          <ul className="divide-y divide-line/70">
            {grp.games.map((g) => (
              <GameRow key={`${g.id}-${flash[g.id] ?? 0}`} game={g} tz={tz} flash={!!flash[g.id]} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function GameRow({ game: g, tz, flash }: { game: GameLite; tz: string; flash: boolean }) {
  const live = g.state === "in";
  const final = g.state === "post";
  const started = live || final;
  const team = (abbr: string, score: number, other: number) => {
    const has = g.possession === abbr && live;
    const winner = final && score > other;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <NflLogo abbr={abbr} size={18} />
          <span className={cn("text-xs font-semibold", winner ? "text-ink" : started ? "text-ink/80" : "text-ink")}>{abbr}</span>
          {has && (
            <span className="text-[10px] text-gold-600 dark:text-gold-400" title="Possession" aria-label="Has possession">
              ●
            </span>
          )}
          {has && g.redZone && (
            <span className="rounded bg-live/15 px-1 text-[9px] font-bold uppercase text-live" title="In the red zone">
              RZ
            </span>
          )}
        </span>
        {started && <span className={cn("text-sm tabular-nums", winner || (live && score > other) ? "font-extrabold text-ink" : "font-semibold text-ink/75")}>{score}</span>}
      </div>
    );
  };
  return (
    <li className={cn("grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2", flash && "animate-flash", live && "bg-live/[0.04]")}>
      <div className="min-w-0 space-y-0.5">
        {team(g.awayTeam, g.awayScore, g.homeScore)}
        {team(g.homeTeam, g.homeScore, g.awayScore)}
      </div>
      <div className="w-32 text-right text-[11px] leading-tight">
        <GameStatusText game={g} tz={tz} className="block" />
        {!started && (g.oddsDetails || g.overUnder) && (
          <span className="mt-0.5 block text-[10px] text-muted">
            {g.oddsDetails && g.oddsDetails !== "EVEN" ? g.oddsDetails : g.oddsDetails === "EVEN" ? "Pick'em" : ""}
            {g.overUnder ? `${g.oddsDetails ? " · " : ""}O/U ${g.overUnder}` : ""}
          </span>
        )}
        {!started && g.broadcast && <span className="block text-[10px] text-muted">{g.broadcast}</span>}
      </div>
    </li>
  );
}
