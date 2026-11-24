// Loads a trade snapshot from the database (or an open transaction) and runs the pure trade rules.
import type { Prisma, PrismaClient } from "@prisma/client";
import type { LeagueSettings } from "@/lib/settings/schema";
import { firstOpenDraftSeason } from "@/lib/picks";
import { pickTradingOpen } from "@/lib/draft/trading";
import { championshipStatus, eliminationBlock, eliminationRuleActive } from "@/lib/playoffs/elimination";
import { checkTrade, tradeLockProblems, type CheckOptions, type CheckResult, type TradeInput, type TradeSnapshot } from "@/lib/trades/rules";

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

export interface ValidateOptions extends Pick<CheckOptions, "checkWindow" | "strictTeams" | "skipRosterChecks"> {
  /**
   * League-state locks on top of the pure rules (default: same as checkWindow, i.e. when a team proposes, accepts
   * or previews a trade): draft picks of a season whose rookie draft is running (draft.rookie.tradingDuringDraft)
   * and teams eliminated from the playoffs (playoffs.eliminatedTeamsCanTransact).
   */
  checkLocks?: boolean;
}

/** League-state locks found on a trade, by kind (see tradeLocks). */
export interface TradeLockErrors {
  /** picks of a season whose rookie draft is running (draft.rookie.tradingDuringDraft): clears when the draft ends */
  picks: string[];
  /** teams that can't trade because they are out of the championship race (playoffs.eliminatedTeamsCanTransact) */
  teams: string[];
}

/**
 * League-state locks for a trade: pick seasons whose rookie draft is running (pickTradingOpen for every season of a
 * pick in the trade) and teams that can't trade because they are out of the championship race.
 */
export async function tradeLocks(tx: Tx, ctx: ValidateContext, input: TradeInput, snapshot: TradeSnapshot): Promise<TradeLockErrors> {
  const s = ctx.settings;
  // with pick trading off entirely, checkTrade already reports it
  const seasons = s.trades.enabled && s.trades.allowDraftPickTrading ? [...new Set([...snapshot.picks.values()].map((p) => p.season))] : [];
  const [pickLocks, statuses] = await Promise.all([
    Promise.all(seasons.map(async (season) => [season, await pickTradingOpen(ctx.leagueId, season, s, tx)] as const)),
    eliminationRuleActive(s, ctx.phase, "TRADE") ? championshipStatus(ctx.leagueId, ctx.season, s, tx) : Promise.resolve(null),
  ]);
  const lockedPickSeasons = new Map<number, string>();
  for (const [season, r] of pickLocks) if (!r.ok) lockedPickSeasons.set(season, r.reason);
  const blockedTeams = new Map<string, string>();
  if (statuses) {
    for (const id of new Set(input.teamIds)) {
      const reason = eliminationBlock(s, ctx.phase, statuses.get(id), "TRADE", snapshot.teams.get(id)?.name ?? "A team in this trade");
      if (reason) blockedTeams.set(id, reason);
    }
  }
  return {
    picks: tradeLockProblems({ teamIds: [], assets: input.assets }, snapshot.picks, { lockedPickSeasons, blockedTeams: new Map() }),
    teams: tradeLockProblems({ teamIds: input.teamIds, assets: [] }, snapshot.picks, { lockedPickSeasons: new Map(), blockedTeams }),
  };
}

/** All league-state lock errors for a trade (empty when nothing applies). */
export async function tradeLockErrors(tx: Tx, ctx: ValidateContext, input: TradeInput, snapshot: TradeSnapshot): Promise<string[]> {
  const l = await tradeLocks(tx, ctx, input, snapshot);
  return [...new Set([...l.teams, ...l.picks])];
}

export async function validateTrade(
  tx: Tx,
  ctx: ValidateContext,
  input: TradeInput,
  opts: ValidateOptions,
): Promise<CheckResult & { snapshot: TradeSnapshot; locks: TradeLockErrors }> {
  const snapshot = await loadTradeSnapshot(tx, ctx.leagueId, input, ctx.settings, ctx.season);
  const { checkLocks = opts.checkWindow, ...checkOpts } = opts;
  const result = checkTrade(input, snapshot, {
    settings: ctx.settings,
    phase: ctx.phase,
    week: ctx.week,
    season: ctx.season,
    nextDraftSeason: firstOpenDraftSeason(ctx.season, ctx.phase),
    now: new Date(),
    ...checkOpts,
  });
  const locks: TradeLockErrors = checkLocks ? await tradeLocks(tx, ctx, input, snapshot) : { picks: [], teams: [] };
  if (locks.picks.length || locks.teams.length) result.errors = [...new Set([...locks.teams, ...locks.picks, ...result.errors])];
  return { ...result, snapshot, locks };
}

/** Are a trade's only blocking errors pick locks from a running rookie draft (so it can wait instead of failing)? */
export function onlyPickLocks(check: { errors: string[]; locks: TradeLockErrors }): boolean {
  if (!check.locks.picks.length) return false;
  const pick = new Set(check.locks.picks);
  return check.errors.every((e) => pick.has(e));
}
