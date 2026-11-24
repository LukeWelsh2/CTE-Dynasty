// Recompute matchups (scores / projections / win probability) for every league's current week.
// The daily stat-correction run also re-scores last week — but only until that league's stat-correction cutoff
// (settings.general.statCorrectionDay / statCorrectionHour) — and forgives retired players' dead money.
import { db } from "@/lib/db";
import { resolveSettings } from "@/lib/settings/schema";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import { publish, topics } from "@/lib/realtime/bus";
import { statCorrectionsOpen } from "@/lib/commissioner/stat-corrections";
import { forgiveRetiredDeadMoney } from "@/lib/roster-ops";

export async function refreshAllLeagues(opts: { includePreviousWeek?: boolean } = {}) {
  const nfl = await getNflState();
  const leagues = await db.league.findMany();
  let n = 0;
  let skipped = 0;
  let forgiven = 0;
  for (const league of leagues) {
    const settings = resolveSettings(league.settings);
    const week = leagueWeekFor(league, settings, nfl);
    const weeks = [week];
    if (opts.includePreviousWeek && week > 1) {
      const last = await db.nflGame.findFirst({
        where: { season: league.season, week: week - 1, seasonType: "REG" },
        orderBy: { startTime: "desc" },
        select: { startTime: true },
      });
      if (statCorrectionsOpen(last?.startTime ?? null, settings)) weeks.unshift(week - 1);
      else skipped++;
    }
    for (const w of weeks) {
      const res = await refreshWeekMatchups(league.id, league.season, w, settings);
      n += res.length;
      publish(topics.league(league.id), "scores.refresh", { week: w });
    }
    if (opts.includePreviousWeek) forgiven += await forgiveRetiredDeadMoney(league.id, settings, league.season).catch(() => 0);
  }
  return `matchups refreshed: ${n}${skipped ? ` · ${skipped} league(s) past the stat-correction cutoff` : ""}${forgiven ? ` · dead money forgiven for ${forgiven} retired player(s)` : ""}`;
}
