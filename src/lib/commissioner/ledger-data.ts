// Loads the league money ledger (dues, empty-starter fines, add/drop fees, weekly high-score prizes)
// from completed matchups, saved lineups and the transaction log. Batched queries, no N+1.
import "server-only";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { capHit } from "@/lib/roster";
import { buildLedger, ledgerActive, luxuryTaxInDues, weeklyHighScorers, type Ledger } from "@/lib/commissioner/ledger";
import { luxuryTaxFor } from "@/lib/commissioner/roster-logic";

/** Transaction types that count as an acquisition for the add/drop fee */
export const FEE_TRANSACTION_TYPES = ["ADD", "WAIVER"];

export async function loadLedger(leagueId: string, season: number, settings: LeagueSettings): Promise<Ledger> {
  const teams = await db.team.findMany({ where: { leagueId }, orderBy: { name: "asc" }, select: { id: true, name: true, abbrev: true } });
  if (!ledgerActive(settings)) return buildLedger(settings, { teams, emptySlots: new Map(), acquisitions: new Map(), highScoreWeeks: new Map() });
  const needFinals = settings.niche.emptyStarterFine > 0 || settings.niche.weeklyHighScorePrize > 0;
  const [finals, acquisitions] = await Promise.all([
    needFinals
      ? db.matchup.findMany({
          where: { leagueId, season, status: "FINAL" },
          select: { week: true, isPlayoff: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
        })
      : Promise.resolve([]),
    settings.waivers.addDropFee > 0
      ? db.transaction.groupBy({ by: ["teamId"], where: { leagueId, season, type: { in: FEE_TRANSACTION_TYPES } }, _count: { _all: true } })
      : Promise.resolve([]),
  ]);

  // (team, week) pairs whose game is final (fines count playoff games too; the high-score prize is regular season only)
  const played = new Set<string>();
  const scores: { teamId: string; week: number; points: number }[] = [];
  for (const m of finals) {
    if (m.homeTeamId) {
      played.add(`${m.homeTeamId}:${m.week}`);
      if (!m.isPlayoff) scores.push({ teamId: m.homeTeamId, week: m.week, points: m.homeScore });
    }
    if (m.awayTeamId) {
      played.add(`${m.awayTeamId}:${m.week}`);
      if (!m.isPlayoff) scores.push({ teamId: m.awayTeamId, week: m.week, points: m.awayScore });
    }
  }

  const emptySlots = new Map<string, number>();
  if (settings.niche.emptyStarterFine > 0 && played.size) {
    const weeks = [...new Set(finals.map((m) => m.week))];
    const empty = await db.lineupSlot.groupBy({ by: ["teamId", "week"], where: { leagueId, season, week: { in: weeks }, playerId: null }, _count: { _all: true } });
    for (const e of empty) if (played.has(`${e.teamId}:${e.week}`)) emptySlots.set(e.teamId, (emptySlots.get(e.teamId) ?? 0) + e._count._all);
  }

  return buildLedger(settings, {
    teams,
    emptySlots,
    acquisitions: new Map(acquisitions.filter((a) => a.teamId).map((a) => [a.teamId!, a._count._all])),
    highScoreWeeks: settings.niche.weeklyHighScorePrize > 0 ? weeklyHighScorers(scores) : new Map(),
    luxuryTax: luxuryTaxInDues(settings) ? await luxuryTaxByTeam(leagueId, season, settings) : undefined,
  });
}

/** Soft-cap luxury tax per team on the current payroll (cap hits + this season's dead money). */
async function luxuryTaxByTeam(leagueId: string, season: number, settings: LeagueSettings): Promise<Map<string, number>> {
  const [spots, states] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId }, select: { teamId: true, salary: true, status: true } }),
    db.leaguePlayerState.findMany({ where: { leagueId, NOT: { deadCap: { equals: [] } } }, select: { deadCap: true } }),
  ]);
  const payroll = new Map<string, number>();
  for (const s of spots) payroll.set(s.teamId, (payroll.get(s.teamId) ?? 0) + capHit(s, settings));
  for (const st of states)
    for (const d of (st.deadCap as { teamId: string; season: number; amount: number }[]) ?? []) if (d.season === season) payroll.set(d.teamId, (payroll.get(d.teamId) ?? 0) + d.amount);
  return new Map([...payroll].map(([teamId, committed]) => [teamId, luxuryTaxFor(committed, settings)]));
}
