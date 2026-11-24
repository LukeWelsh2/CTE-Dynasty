"use client";
// NFL games this week: live scores, quarter/clock, possession, red zone, kickoff times, spread / O-U, TV.
// Grouped by kickoff day; the first few games (and every live one) show, the rest behind "Show all N games".
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { GameLite, NflGamesEvent } from "@/lib/live/types";
import { dateLabel } from "@/lib/live/format";
import { NflLogo } from "@/components/ui/core";
import { cn } from "@/lib/utils";
import { GameStatusText } from "./bits";

export function NflGamesRail({
  leagueId,
  season,
  week,
  tz,
  games: initial,
  initialCount = 5,
}: {
  leagueId: string;
  season: number;
  week: number;
  tz: string;
  games: GameLite[];
  /** games shown before "Show all" (live games always show) */
  initialCount?: number;
}) {
  const [games, setGames] = useState(initial);
  const [flash, setFlash] = useState<Record<string, number>>({});
  const [seen, setSeen] = useState(initial);
  const [all, setAll] = useState(false);
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

  if (!games.length) return <p className="px-4 pb-4 text-[13px] text-muted">No NFL games scheduled this week.</p>;

  // group by kickoff day in the league timezone
  const groups: { day: string; games: GameLite[] }[] = [];
  for (const g of games) {
    const day = dateLabel(g.startTime, tz);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.games.push(g);
    else groups.push({ day, games: [g] });
  }
  // the first `initialCount` games (and every live game) show; the rest behind "Show all N games"
  const keep = new Set(games.filter((g, i) => i < initialCount || g.state === "in").map((g) => g.id));
  const hidden = games.length - keep.size;
  const list = all ? groups : groups.map((grp) => ({ ...grp, games: grp.games.filter((g) => keep.has(g.id)) })).filter((grp) => grp.games.length);

  return (
    <div className="border-t border-line/70">
      {list.map((grp) => (
        <div key={grp.day}>
          <h3 className="eyebrow border-b border-line/70 bg-sunken/60 px-4 py-1.5">{grp.day}</h3>
          <ul className="divide-y divide-line/70">
            {grp.games.map((g) => (
              <GameRow key={`${g.id}-${flash[g.id] ?? 0}`} game={g} tz={tz} flash={!!flash[g.id]} />
            ))}
          </ul>
        </div>
      ))}
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="flex min-h-12 w-full items-center justify-center gap-1 border-t border-line/70 text-[14px] font-semibold text-brand-600 transition-colors hover:bg-sunken/70 dark:text-brand-400"
        >
          {all ? "Show less" : `Show all ${games.length} games`}
          <ChevronDown size={15} className={cn("transition-transform duration-200", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </div>
  );
}

function GameRow({ game: g, tz, flash }: { game: GameLite; tz: string; flash: boolean }) {
  const live = g.state === "in";
  const final = g.state === "post";
  const started = live || final;
  const odds = !started ? [g.oddsDetails === "EVEN" ? "Pick'em" : g.oddsDetails, g.overUnder ? `O/U ${g.overUnder}` : null].filter(Boolean).join(" · ") : "";
  const team = (abbr: string, score: number, other: number) => {
    const has = g.possession === abbr && live;
    const winner = final && score > other;
    const ahead = live && score > other;
    return (
      <span className="flex h-6 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <NflLogo abbr={abbr} size={20} />
          <span className={cn("text-[14px] font-semibold", final && !winner ? "text-muted" : "text-ink")}>{abbr}</span>
          {has && (
            <span className="text-[12px] text-ink" title="Has the ball" aria-label="Has the ball">
              ●
            </span>
          )}
          {has && g.redZone && (
            <span className="rounded bg-live/15 px-1 text-[11px] font-bold uppercase text-live" title="In the red zone">
              RZ
            </span>
          )}
        </span>
        {started && <span className={cn("numeral text-[15px]", winner || ahead ? "font-bold text-ink" : "font-semibold text-muted")}>{score}</span>}
      </span>
    );
  };
  return (
    <li className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-2", flash && "animate-flash", live && "bg-live/[0.04]")}>
      <span className="min-w-0">
        {team(g.awayTeam, g.awayScore, g.homeScore)}
        {team(g.homeTeam, g.homeScore, g.awayScore)}
      </span>
      <span className={cn("text-right text-[12px] leading-4", started ? "w-16" : "w-36")}>
        <GameStatusText game={g} tz={tz} className="block font-semibold" />
        {odds && <span className="mt-0.5 block truncate text-muted">{odds}</span>}
        {!started && g.broadcast && <span className="block truncate text-muted">{g.broadcast}</span>}
      </span>
    </li>
  );
}
