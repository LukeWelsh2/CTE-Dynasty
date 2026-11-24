// Which fantasy week a league is on (safe to import from jobs/scripts — no request context needed).
import type { League } from "@prisma/client";
import type { LeagueSettings } from "@/lib/settings/schema";
import type { NflState } from "@/lib/nfl/state";

/** Last week of the fantasy season (end of playoffs) */
export function lastFantasyWeek(settings: LeagueSettings): number {
  const rounds = Math.ceil(Math.log2(Math.max(2, settings.playoffs.teams)));
  return Math.min(18, settings.playoffs.startWeek + rounds * settings.playoffs.weeksPerRound - 1 + (settings.playoffs.championshipWeeks - 1));
}

/** Week the league is currently on, honoring commissioner overrides. */
export function leagueWeekFor(league: Pick<League, "weekOverride" | "season">, settings: LeagueSettings, nfl: NflState): number {
  if (league.weekOverride) return league.weekOverride;
  if (nfl.season > league.season) return lastFantasyWeek(settings);
  if (nfl.season < league.season) return 1;
  return Math.max(1, Math.min(18, nfl.week));
}
