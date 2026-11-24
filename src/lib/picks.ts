// Rookie draft pick assets. Every team always holds `futurePickYears` seasons of picks (default 3 years x 2 rounds).
import type { DraftPick, Team } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { ordinal } from "@/lib/utils";

/** First rookie-draft season that has not happened yet for this league. */
export function firstOpenDraftSeason(leagueSeason: number, phase: string): number {
  // During/after the season the next rookie draft is next year; in PRESEASON the current year's draft may still be pending.
  return phase === "PRESEASON" ? leagueSeason : leagueSeason + 1;
}

/** Ensure every team has picks for [fromSeason, fromSeason + years) for each round. Idempotent. */
export async function ensureDraftPicks(leagueId: string, fromSeason: number, settings: LeagueSettings) {
  const teams = await db.team.findMany({ where: { leagueId }, select: { id: true } });
  const years = settings.trades.futurePickYears;
  const rounds = settings.draft.rookie.rounds;
  const data = [];
  for (let y = 0; y < years; y++)
    for (let r = 1; r <= rounds; r++)
      for (const t of teams) data.push({ leagueId, season: fromSeason + y, round: r, originalTeamId: t.id, ownerTeamId: t.id });
  const res = await db.draftPick.createMany({ data, skipDuplicates: true });
  return res.count;
}

export function pickShortLabel(pick: Pick<DraftPick, "season" | "round" | "pickInRound">): string {
  if (pick.pickInRound) return `${pick.season} ${pick.round}.${String(pick.pickInRound).padStart(2, "0")}`;
  return `${pick.season} ${ordinal(pick.round)}`;
}

export function pickLabel(pick: Pick<DraftPick, "season" | "round" | "pickInRound" | "originalTeamId" | "ownerTeamId">, teams: Map<string, Pick<Team, "name" | "abbrev">>): string {
  const base = pick.pickInRound ? `${pick.season} Round ${pick.round}, Pick ${pick.pickInRound}` : `${pick.season} ${ordinal(pick.round)} Round`;
  if (pick.originalTeamId !== pick.ownerTeamId) return `${base} (via ${teams.get(pick.originalTeamId)?.name ?? "?"})`;
  return base;
}

export async function teamPicks(teamId: string, minSeason?: number) {
  return db.draftPick.findMany({
    where: { ownerTeamId: teamId, playerId: null, ...(minSeason ? { season: { gte: minSeason } } : {}) },
    include: { originalTeam: true },
    orderBy: [{ season: "asc" }, { round: "asc" }, { pickInRound: "asc" }],
  });
}
