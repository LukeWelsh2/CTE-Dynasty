// Recompute matchups (scores / projections / win probability) for every league's current week.
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { publish, topics } from "@/lib/realtime/bus";

export async function refreshAllLeagues(opts: { includePreviousWeek?: boolean } = {}) {
  const nfl = await getNflState();
  const leagues = await db.league.findMany();
  let n = 0;
  for (const league of leagues) {
    const settings = resolveSettings(league.settings);
    const week = leagueWeekFor(league, settings, nfl);
    const weeks = opts.includePreviousWeek && week > 1 ? [week - 1, week] : [week];
    for (const w of weeks) {
      const res = await refreshWeekMatchups(league.id, league.season, w, settings);
      n += res.length;
      publish(topics.league(league.id), "scores.refresh", { week: w });
    }
  }
  return `matchups refreshed: ${n}`;
}
