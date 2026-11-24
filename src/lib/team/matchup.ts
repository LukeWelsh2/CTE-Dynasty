// Recompute a team's matchup (projection + win probability) after a lineup or roster change and push it live.
import type { Matchup } from "@prisma/client";
import { db } from "@/lib/db";
import { publish, topics } from "@/lib/realtime/bus";
import type { ScoreUpdateEvent } from "@/lib/realtime/events";
import { refreshWeekMatchups } from "@/lib/scoreboard";
import type { LeagueSettings } from "@/lib/settings/schema";

const SCORE_FIELDS = ["homeScore", "awayScore", "homeProjected", "awayProjected", "homeWinProb", "status", "winnerTeamId"] as const;

/** Did a refresh change anything a live view shows? */
export function scoreChanged(before: Pick<Matchup, (typeof SCORE_FIELDS)[number]>, after: Pick<Matchup, (typeof SCORE_FIELDS)[number]>): boolean {
  return SCORE_FIELDS.some((k) => before[k] !== after[k]);
}

export function scoreUpdateEvent(m: Matchup): ScoreUpdateEvent {
  return {
    matchupId: m.id,
    week: m.week,
    homeTeamId: m.homeTeamId,
    awayTeamId: m.awayTeamId,
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homeProjected: m.homeProjected,
    awayProjected: m.awayProjected,
    homeWinProb: m.homeWinProb,
    status: m.status,
  };
}

/**
 * Refresh the week of a team whose lineup or roster just changed, and publish score.update for the rows that changed.
 * Delegates to refreshWeekMatchups so the row follows exactly the rules every other score path applies: best ball /
 * auto-subs / empty-slot penalty, roster.illegalRosterPolicy ZERO_POINTS, the flipped win probability of a regular
 * season niche.reverseScoringWeek, and playoff rows settled by the bracket (a multi-week game's weeks). A FINAL
 * matchup is left alone (the commissioner recalculates final weeks from the schedule tools).
 */
export async function refreshTeamMatchup(leagueId: string, season: number, week: number, teamId: string, settings: LeagueSettings): Promise<Matchup | null> {
  const m = await db.matchup.findFirst({ where: { leagueId, season, week, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] } });
  if (!m || m.status === "FINAL") return null;
  const before = new Map((await db.matchup.findMany({ where: { leagueId, season, week } })).map((r) => [r.id, r]));
  const results = await refreshWeekMatchups(leagueId, season, week, settings);
  let mine: Matchup | null = null;
  for (const { matchup } of results) {
    if (matchup.id === m.id) mine = matchup;
    const prev = before.get(matchup.id);
    if (matchup.id !== m.id && prev && !scoreChanged(prev, matchup)) continue;
    publish(topics.league(leagueId), "score.update", scoreUpdateEvent(matchup));
  }
  return mine;
}
