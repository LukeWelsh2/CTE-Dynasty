"use client";
// "Big plays" feed: touchdowns, long gains, 50+ yd field goals, takeaways — from ScoringEvent rows plus
// live scoring.play events. Optionally restricted to a set of fantasy teams (matchup page).
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronDown, Zap } from "lucide-react";
import { useLiveEvents } from "@/lib/realtime/client";
import type { ScoringPlayEvent } from "@/lib/realtime/events";
import type { BigPlay } from "@/lib/live/types";
import { TOUCHDOWN_KEYS } from "@/lib/scoring/engine";
import { Badge, PlayerHeadshot } from "@/components/ui/core";
import { cn, timeAgo } from "@/lib/utils";
import { PointsDelta } from "./bits";

export function BigPlaysFeed({
  leagueId,
  plays: initial,
  teams,
  teamIds,
  limit = 25,
  show = 5,
  live = true,
  emptyText = "Touchdowns and big plays by rostered players show up here as they happen.",
}: {
  leagueId: string;
  plays: BigPlay[];
  teams: Record<string, { abbrev: string; primaryColor: string }>;
  teamIds?: string[];
  limit?: number;
  /** rows shown before "Show N more" */
  show?: number;
  /** subscribe to live plays (only for the week currently being played / simulated) */
  live?: boolean;
  emptyText?: string;
}) {
  const [plays, setPlays] = useState(initial);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState(initial);
  const [, setNow] = useState(0);
  const [all, setAll] = useState(false);
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
      <p className="flex items-center gap-2 px-4 pb-4 text-[13px] text-muted">
        <Zap size={15} className="shrink-0" aria-hidden />
        {emptyText}
      </p>
    );

  const list = plays.slice(0, limit);
  const hidden = Math.max(0, list.length - show);
  return (
    <>
      <ul className="divide-y divide-line/70 border-t border-line/70" aria-live="polite">
        {(all ? list : list.slice(0, show)).map((p) => {
          const td = TOUCHDOWN_KEYS.includes(p.statKey);
          return (
            <li key={p.id} className={cn(fresh.has(p.id) && "animate-flash")}>
              <Link
                href={`/players/${p.playerId}`}
                className="flex min-h-[52px] items-start gap-3 px-4 py-2.5 transition-colors hover:bg-sunken/70 active:bg-sunken"
              >
                <PlayerHeadshot player={{ id: p.playerId, fullName: p.playerName, position: p.position }} size={32} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start gap-1.5">
                    {td && (
                      <Badge tone="brand" className="mt-px shrink-0">
                        TD
                      </Badge>
                    )}
                    <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink" title={p.description}>
                      {p.description}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
                    {p.fantasyTeam && (
                      <span className="inline-flex items-center gap-1 font-semibold text-ink">
                        <span className="h-3 w-1 rounded-sm ring-1 ring-inset ring-black/10 dark:ring-white/30" style={{ background: p.fantasyTeam.primaryColor }} aria-hidden />
                        {p.fantasyTeam.abbrev}
                      </span>
                    )}
                    <span>
                      {p.position}
                      {p.nflTeam ? ` · ${p.nflTeam}` : ""}
                    </span>
                    <span aria-hidden>·</span>
                    <time dateTime={p.at} suppressHydrationWarning>
                      {timeAgo(p.at)}
                    </time>
                  </span>
                </span>
                <PointsDelta points={p.points} className="mt-0.5 shrink-0 text-[14px]" />
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="flex min-h-12 w-full items-center justify-center gap-1 border-t border-line/70 text-[14px] font-semibold text-brand-600 transition-colors hover:bg-sunken/70 dark:text-brand-400"
        >
          {all ? "Show less" : `Show ${hidden} more`}
          <ChevronDown size={15} className={cn("transition-transform duration-200", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </>
  );
}
