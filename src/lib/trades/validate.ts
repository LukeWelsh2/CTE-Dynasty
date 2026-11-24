// Loads a trade snapshot from the database (or an open transaction) and runs the pure trade rules.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { LeagueSettings } from "@/lib/settings/schema";
import { firstOpenDraftSeason } from "@/lib/picks";
import { checkTrade, type CheckOptions, type CheckResult, type TradeInput, type TradeSnapshot } from "@/lib/trades/rules";

export type Tx = Prisma.TransactionClient | PrismaClient;

/** Dead money per team for the current and next season from LeaguePlayerState.deadCap */
export async function deadMoneyByTeam(tx: Tx, leagueId: string, season: number): Promise<Map<string, { current: number; next: number }>> {
  const states = await tx.leaguePlayerState.findMany({ where: { leagueId }, select: { deadCap: true } });
  const out = new Map<string, { current: number; next: number }>();
  for (const st of states) {
    for (const d of (st.deadCap as { teamId: string; season: number; amount: number }[] | null) ?? []) {
      if (d.season !== season && d.season !== season + 1) continue;
      const o = out.get(d.teamId) ?? { current: 0, next: 0 };
      if (d.season === season) o.current += d.amount;
      else o.next += d.amount;
      out.set(d.teamId, o);
    }
  }
  return out;
}

export async function loadTradeSnapshot(tx: Tx, leagueId: string, input: TradeInput, settings: LeagueSettings, season: number): Promise<TradeSnapshot> {
  const teamIds = [...new Set(input.teamIds)];
  const pickIds = input.assets.filter((a) => a.type === "PICK" && a.pickId).map((a) => a.pickId!);
  const playerIds = input.assets.filter((a) => a.type === "PLAYER" && a.playerId).map((a) => a.playerId!);
  const cooldownDays = settings.trades.tradeBackCooldownDays;
  const [teams, spots, extraSpots, picks, deadMoney, recent] = await Promise.all([
    tx.team.findMany({ where: { leagueId, id: { in: teamIds } }, select: { id: true, name: true, faabBalance: true } }),
    tx.rosterSpot.findMany({ where: { leagueId, teamId: { in: teamIds } }, include: { player: { select: { fullName: true, position: true, injuryStatus: true, status: true, yearsExp: true } } } }),
    // traded players that are no longer on any of the involved teams (to report where they went)
    tx.rosterSpot.findMany({ where: { leagueId, playerId: { in: playerIds }, teamId: { notIn: teamIds } }, include: { player: { select: { fullName: true, position: true, injuryStatus: true, status: true, yearsExp: true } } } }),
    pickIds.length ? tx.draftPick.findMany({ where: { leagueId, id: { in: pickIds } } }) : Promise.resolve([]),
    deadMoneyByTeam(tx, leagueId, season),
    cooldownDays > 0 && playerIds.length
      ? tx.tradeAsset.findMany({
          where: { type: "PLAYER", playerId: { in: playerIds }, trade: { leagueId, status: "COMPLETED", completedAt: { gte: new Date(Date.now() - cooldownDays * 864e5) } } },
          include: { trade: { select: { completedAt: true } } },
        })
      : Promise.resolve([]),
  ]);
  return {
    teams: new Map(teams.map((t) => [t.id, t])),
    spots: [...spots, ...extraSpots].map((s) => ({
      playerId: s.playerId,
      teamId: s.teamId,
      status: s.status,
      salary: s.salary,
      contractYears: s.contractYears,
      isRookieContract: s.isRookieContract,
      player: s.player,
    })),
    picks: new Map(picks.map((p) => [p.id, { id: p.id, season: p.season, round: p.round, pickInRound: p.pickInRound, ownerTeamId: p.ownerTeamId, originalTeamId: p.originalTeamId, playerId: p.playerId ?? (p.usedAt ? "used" : null) }])),
    deadMoney,
    recentMoves: recent.map((r) => ({ playerId: r.playerId!, fromTeamId: r.fromTeamId, toTeamId: r.toTeamId, completedAt: r.trade.completedAt ?? new Date(0) })),
  };
}

export interface ValidateContext {
  leagueId: string;
  season: number;
  phase: string;
  week: number;
  settings: LeagueSettings;
}

export async function validateTrade(
  tx: Tx,
  ctx: ValidateContext,
  input: TradeInput,
  opts: Pick<CheckOptions, "checkWindow" | "strictTeams" | "skipRosterChecks">,
): Promise<CheckResult & { snapshot: TradeSnapshot }> {
  const snapshot = await loadTradeSnapshot(tx, ctx.leagueId, input, ctx.settings, ctx.season);
  const result = checkTrade(input, snapshot, {
    settings: ctx.settings,
    phase: ctx.phase,
    week: ctx.week,
    season: ctx.season,
    nextDraftSeason: firstOpenDraftSeason(ctx.season, ctx.phase),
    now: new Date(),
    ...opts,
  });
  return { ...result, snapshot };
}

