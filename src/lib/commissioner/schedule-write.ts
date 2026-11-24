// Writes a league's regular season schedule with the settings-aware generator (round robin / division
// weighted, division games twice or late, odd-team byes or median games, rivalry week). Server-only.
// The commissioner's "Regenerate schedule" tool uses the same generator; the season rollover can call
// writeSeasonSchedule() instead of the simple round robin in @/lib/schedule.
import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { buildSeasonSchedule, type PlannedMatchup } from "@/lib/commissioner/schedule-gen";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Settings-aware plan for one league season (teams in creation order so partial regenerations line up). */
export async function planSeasonSchedule(leagueId: string, settings: LeagueSettings, tx: Tx = db): Promise<PlannedMatchup[]> {
  const teams = await tx.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" }, select: { id: true, division: true } });
  if (teams.length < 2) return [];
  return buildSeasonSchedule(teams, settings);
}

/**
 * Replace the regular season matchups from `fromWeek` (default: the first week) through the last regular
 * season week. Playoff matchups are never touched. Returns the number of matchups written.
 */
export async function writeSeasonSchedule(leagueId: string, season: number, settings: LeagueSettings, opts: { fromWeek?: number } = {}): Promise<number> {
  const first = settings.general.firstWeek;
  const last = first + settings.general.regularSeasonWeeks - 1;
  const fromWeek = Math.max(first, opts.fromWeek ?? first);
  const plan = (await planSeasonSchedule(leagueId, settings)).filter((m) => m.week >= fromWeek && m.week <= last);
  await db.$transaction([
    db.matchup.deleteMany({ where: { leagueId, season, isPlayoff: false, week: { gte: fromWeek, lte: last } } }),
    db.matchup.createMany({
      data: plan.map((m) => ({ leagueId, season, week: m.week, homeTeamId: m.homeTeamId, awayTeamId: m.awayTeamId, label: m.label === "Bye" ? null : m.label })),
    }),
  ]);
  return plan.length;
}
