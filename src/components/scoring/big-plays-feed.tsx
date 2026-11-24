"use client";
// "Big plays" feed: touchdowns, long gains, 50+ yd field goals, takeaways — from ScoringEvent rows plus
// live scoring.play events. Optionally restricted to a set of fantasy teams (matchup page).
import Link from "next/link";
import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoringPlayEvent } from "@/lib/realtime/events";
import type { BigPlay } from "@/lib/live/types";
import { TOUCHDOWN_KEYS } from "@/lib/scoring/engine";
import { PlayerHeadshot } from "@/components/ui/core";
import { cn, timeAgo } from "@/lib/utils";
import { PointsDelta } from "./bits";

export function BigPlaysFeed({
  leagueId,
  plays: initial,
  teams,
  teamIds,
  limit = 25,
  live = true,
  emptyText = "Touchdowns and big plays by rostered players show up here as they happen.",
}: {
  leagueId: string;
  plays: BigPlay[];
  teams: Record<string, { abbrev: string; primaryColor: string }>;
  teamIds?: string[];
  limit?: number;
  /** subscribe to live plays (only for the week currently being played / simulated) */
  live?: boolean;
  emptyText?: string;
}) {
  const [plays, setPlays] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(initial);
  const [, setNow] = useState(0);
  if (seen !== initial) {
    setSeen(initial);
    setPlays(initial);
  }
  // keep "x minutes ago" labels current
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  useLiveEvents([live ? `league:${leagueId}` : null], (e) => {
    if (e.type === "scoring.play") {
      const p = e.data as ScoringPlayEvent;
      if (teamIds && (!p.fantasyTeamId || !teamIds.includes(p.fantasyTeamId))) return;
      const team = p.fantasyTeamId ? teams[p.fantasyTeamId] : undefined;
      const play: BigPlay = {
        id: p.id,
        playerId: p.playerId,
        playerName: p.playerName,
        position: p.position,
        nflTeam: p.nflTeam,
        statKey: p.statKey,
        points: p.points,
        description: p.description,
        fantasyTeam: p.fantasyTeamId && team ? { id: p.fantasyTeamId, ...team } : null,
        at: p.at,
      };
      setPlays((cur) => (cur.some((x) => x.id === play.id) ? cur : [play, ...cur].slice(0, limit)));
      setFresh((f) => new Set(f).add(play.id));
    }
  });

  if (!plays.length)
    return (
      <div className="flex flex-col items-center px-4 py-8 text-center text-sm text-muted">
        <Zap size={20} className="mb-2" aria-hidden />
        {emptyText}
      </div>
    );

  return (
    <ul className="divide-y divide-line/70" aria-live="polite">
      {plays.slice(0, limit).map((p) => {
        const td = TOUCHDOWN_KEYS.includes(p.statKey);
        return (
          <li key={p.id} className={cn("flex items-start gap-2.5 px-3 py-2", fresh.has(p.id) && "animate-flash")}>
            <PlayerHeadshot player={{ id: p.playerId, fullName: p.playerName, position: p.position }} size={30} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                {td && <span className="rounded bg-gold-500 px-1 text-[9px] font-extrabold uppercase text-brand-950">TD</span>}
                <Link href={`/players/${p.playerId}`} title={p.description} className="truncate text-xs font-semibold text-ink hover:underline">
                  {p.description}
                </Link>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                {p.fantasyTeam && (
                  <span className="inline-flex items-center gap-1 font-semibold text-ink/80">
                    <span className="h-2.5 w-1 rounded-sm" style={{ background: p.fantasyTeam.primaryColor }} aria-hidden />
                    {p.fantasyTeam.abbrev}
                  </span>
                )}
                <span>
                  {p.position}
                  {p.nflTeam ? ` · ${p.nflTeam}` : ""}
                </span>
                <span aria-hidden>·</span>
                <time dateTime={p.at}>{timeAgo(p.at)}</time>
              </div>
            </div>
            <PointsDelta points={p.points} className="shrink-0 text-xs" />
          </li>
        );
      })}
    </ul>
  );
}
