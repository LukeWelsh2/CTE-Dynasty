// Recompute one team's matchup (projection + win probability) after a lineup or roster change and push it live.
import { db } from "@/lib/db";
import { weekGamesByTeam } from "@/lib/lineup";
import { publish, topics } from "@/lib/realtime/bus";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import { teamWeekScore, winProbability } from "@/lib/scoreboard";
import type { LeagueSettings } from "@/lib/settings/schema";

export async function refreshTeamMatchup(leagueId: string, season: number, week: number, teamId: string, settings: LeagueSettings) {
  const m = await db.matchup.findFirst({ where: { leagueId, season, week, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] } });
  if (!m || m.status === "FINAL") return null;
  const games = await weekGamesByTeam(season, week);
  const [home, away] = await Promise.all([
    m.homeTeamId ? teamWeekScore(m.homeTeamId, leagueId, season, week, settings, { games }) : null,
    m.awayTeamId ? teamWeekScore(m.awayTeamId, leagueId, season, week, settings, { games }) : null,
  ]);
  const homeWinProb = home && away ? winProbability(home, away) : home ? 1 : 0;
  const updated = await db.matchup.update({
    where: { id: m.id },
    data: {
      homeScore: home?.points ?? 0,
      awayScore: away?.points ?? 0,
      homeProjected: home?.liveProjected ?? 0,
      awayProjected: away?.liveProjected ?? 0,
      homeWinProb,
    },
  });
  const evt: ScoreUpdateEvent = {
    matchupId: updated.id,
    week: updated.week,
    homeTeamId: updated.homeTeamId,
    awayTeamId: updated.awayTeamId,
    homeScore: updated.homeScore,
    awayScore: updated.awayScore,
    homeProjected: updated.homeProjected,
    awayProjected: updated.awayProjected,
    homeWinProb: updated.homeWinProb,
    status: updated.status,
  };
  publish(topics.league(leagueId), "score.update", evt);
  return updated;
}
