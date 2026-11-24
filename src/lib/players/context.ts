// League-level fantasy state needed to render any player row: ownership, waivers, game locks, my claims,
// my watch list. Loaded once per request with a handful of batched queries.
import "server-only";
import type { NflGame, RosterSpot, Team, WaiverClaim } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { weekGamesByTeam } from "@/lib/lineup";
import { tradeWindow } from "@/lib/trades/rules";
import { lastWaiverRun, nextWaiverRun } from "@/lib/waiver-schedule";
import { fmtDateTime } from "@/lib/players/format";
import { auctionPoolPlayerIds } from "@/lib/draft/trading";
import { championshipStatus, eliminationBlock, eliminationRuleActive, type ChampionshipStatus } from "@/lib/playoffs/elimination";
import { AUCTION_POOL_REASON, acquisitionMode, freeAgentGameLocked, readdCooldownUntil, type AcquisitionMode } from "@/lib/players/logic";

export type SpotWithTeam = RosterSpot & { team: Team };

export interface FantasyContext {
  now: Date;
  spots: Map<string, SpotWithTeam>;
  waiverUntil: Map<string, Date>;
  /** players my team dropped recently and can't re-add yet (settings.waivers.dropCooldownHours) */
  readdUntil: Map<string, Date>;
  myClaims: Map<string, WaiverClaim>;
  watch: Set<string>;
  games: Map<string, NflGame>;
  /** last week's games: players whose game kicked off after the last waiver run stay locked until the next run */
  prevGames: Map<string, NflGame>;
  lastRun: Date | null;
  /** memoized nextWaiverRun (the result only depends on the hour of `from`) */
  nextRun: (from: Date) => Date | null;
  teams: Team[];
  /** why my team can't add anyone right now (eliminated from the playoffs), or null */
  teamBlock: string | null;
  /** players held for the auction pool (settings.keepers.releasedPlayersReturnTo): can't be added or claimed */
  auctionPool: Set<string>;
  /** can my team propose trades right now (settings.trades + deadline + playoffs.eliminatedTeamsCanTransact) */
  tradesOpen: boolean;
  /** why trading is closed (deadline passed, playoffs, disabled, my team eliminated), null when open */
  tradesClosedReason: string | null;
  /** other teams that can't trade right now (eliminated from the playoffs) → reason */
  tradeBlockedTeams: Map<string, string>;
}

/** Previous fantasy week's NFL games (empty in week 1) */
export async function previousWeekGames(ctx: Pick<LeagueContext, "season" | "week">): Promise<Map<string, NflGame>> {
  return ctx.week > 1 ? weekGamesByTeam(ctx.season, ctx.week - 1) : new Map();
}

/**
 * Championship status per team (@/lib/playoffs/elimination), loaded only while an elimination rule restricts adds
 * (waivers.eliminatedTeamsCanAdd / playoffs.eliminatedTeamsCanTransact) or trades (playoffs.eliminatedTeamsCanTransact).
 */
export async function eliminationStatuses(ctx: LeagueContext): Promise<Map<string, ChampionshipStatus> | null> {
  const phase = ctx.league.phase;
  if (!eliminationRuleActive(ctx.settings, phase, "ADD") && !eliminationRuleActive(ctx.settings, phase, "TRADE")) return null;
  return championshipStatus(ctx.league.id, ctx.season, ctx.settings);
}

/** Team-level add block for my team: knocked out of (or never in) the championship bracket during the playoffs. */
export function teamAddBlockFrom(ctx: LeagueContext, statuses: ReadonlyMap<string, ChampionshipStatus> | null): string | null {
  if (!ctx.myTeam || !statuses) return null;
  return eliminationBlock(ctx.settings, ctx.league.phase, statuses.get(ctx.myTeam.id), "ADD");
}

export async function teamAddBlock(ctx: LeagueContext): Promise<string | null> {
  if (!ctx.myTeam || !eliminationRuleActive(ctx.settings, ctx.league.phase, "ADD")) return null;
  return teamAddBlockFrom(ctx, await championshipStatus(ctx.league.id, ctx.season, ctx.settings));
}

/** Players held for the auction pool among `playerIds` (all of them when omitted). */
export function auctionPoolFor(ctx: LeagueContext, playerIds?: string[]): Promise<Set<string>> {
  return auctionPoolPlayerIds(ctx.league.id, ctx.season, ctx.settings, { playerIds });
}

/**
 * Trade window as seen by my team: the league window (settings.trades, deadline, playoffs), then
 * playoffs.eliminatedTeamsCanTransact for my own team. `blockedTeams` lists the other teams that can't trade.
 */
export function teamTradeWindow(
  ctx: LeagueContext,
  statuses: ReadonlyMap<string, ChampionshipStatus> | null,
  teams: { id: string; name: string }[],
): { open: boolean; reason: string | null; blockedTeams: Map<string, string> } {
  const tw = tradeWindow(ctx.settings, ctx.league.phase, ctx.week);
  const blockedTeams = new Map<string, string>();
  if (statuses) {
    for (const t of teams) {
      if (t.id === ctx.myTeam?.id) continue;
      const reason = eliminationBlock(ctx.settings, ctx.league.phase, statuses.get(t.id), "TRADE", t.name);
      if (reason) blockedTeams.set(t.id, reason);
    }
  }
  if (!tw.open) return { open: false, reason: tw.reason, blockedTeams };
  const mine = ctx.myTeam && statuses ? eliminationBlock(ctx.settings, ctx.league.phase, statuses.get(ctx.myTeam.id), "TRADE") : null;
  return mine ? { open: false, reason: mine, blockedTeams } : { open: true, reason: null, blockedTeams };
}

/** Why my team can't trade for a player owned by `ownerTeamId` (null = it can). */
export function tradeBlockFor(fc: Pick<FantasyContext, "tradesOpen" | "tradesClosedReason" | "tradeBlockedTeams">, ownerTeamId: string): string | null {
  if (!fc.tradesOpen) return fc.tradesClosedReason;
  return fc.tradeBlockedTeams.get(ownerTeamId) ?? null;
}

export function readdReason(until: Date, tz: string): string {
  return `You dropped him recently — you can re-add him after ${fmtDateTime(until, tz)}.`;
}

export async function loadFantasyContext(ctx: LeagueContext): Promise<FantasyContext> {
  const now = new Date();
  const cooldownHours = ctx.settings.waivers.dropCooldownHours ?? 0;
  const [spots, states, claims, watch, games, prevGames, teams, statuses, auctionPool] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId: ctx.league.id }, include: { team: true } }),
    db.leaguePlayerState.findMany({
      where: {
        leagueId: ctx.league.id,
        OR: [
          { waiverClearsAt: { gt: now } },
          ...(cooldownHours > 0 && ctx.myTeam ? [{ lastDroppedById: ctx.myTeam.id, lastDroppedAt: { gt: new Date(now.getTime() - cooldownHours * 3600_000) } }] : []),
        ],
      },
      select: { playerId: true, waiverClearsAt: true, lastDroppedById: true, lastDroppedAt: true },
    }),
    ctx.myTeam ? db.waiverClaim.findMany({ where: { teamId: ctx.myTeam.id, status: "PENDING" } }) : Promise.resolve([] as WaiverClaim[]),
    db.watchlistEntry.findMany({ where: { userId: ctx.user.id, leagueId: ctx.league.id }, select: { playerId: true } }),
    weekGamesByTeam(ctx.season, ctx.week),
    previousWeekGames(ctx),
    db.team.findMany({ where: { leagueId: ctx.league.id }, orderBy: { name: "asc" } }),
    eliminationStatuses(ctx),
    ctx.myTeam ? auctionPoolFor(ctx) : Promise.resolve(new Set<string>()),
  ]);
  const waiverUntil = new Map<string, Date>();
  const readdUntil = new Map<string, Date>();
  for (const s of states) {
    if (s.waiverClearsAt && s.waiverClearsAt > now) waiverUntil.set(s.playerId, s.waiverClearsAt);
    const until = readdCooldownUntil(ctx.settings, s, ctx.myTeam?.id, now);
    if (until) readdUntil.set(s.playerId, until);
  }
  const tw = teamTradeWindow(ctx, statuses, teams);
  return {
    now,
    spots: new Map(spots.map((s) => [s.playerId, s])),
    waiverUntil,
    readdUntil,
    myClaims: new Map(claims.map((c) => [c.addPlayerId, c])),
    watch: new Set(watch.map((w) => w.playerId)),
    games,
    prevGames,
    lastRun: lastWaiverRun(ctx.settings, now),
    nextRun: memoNextRun(ctx),
    teams,
    teamBlock: teamAddBlockFrom(ctx, statuses),
    auctionPool,
    tradesOpen: tw.open,
    tradesClosedReason: tw.open ? null : tw.reason,
    tradeBlockedTeams: tw.blockedTeams,
  };
}

function memoNextRun(ctx: LeagueContext) {
  const memo = new Map<number, Date | null>();
  return (from: Date) => {
    const key = Math.floor(from.getTime() / 3600_000);
    if (!memo.has(key)) memo.set(key, nextWaiverRun(ctx.settings, from));
    return memo.get(key)!;
  };
}

export interface Availability {
  spot: SpotWithTeam | null;
  isMine: boolean;
  /** shown as "W (Wed)" */
  onWaivers: boolean;
  gameLocked: boolean;
  /** null when rostered */
  mode: AcquisitionMode | null;
  /** when waiver claims on this player will process */
  processAt: Date | null;
}

export function availabilityFor(ctx: LeagueContext, fc: FantasyContext, player: { id: string; team: string | null }): Availability {
  const spot = fc.spots.get(player.id) ?? null;
  if (spot) return { spot, isMine: spot.teamId === ctx.myTeam?.id, onWaivers: false, gameLocked: false, mode: null, processAt: null };
  const clears = fc.waiverUntil.get(player.id) ?? null;
  const gameLocked = freeAgentGameLocked(player.team, ctx.settings, fc.games, fc.prevGames, fc.now, fc.lastRun);
  const readd = fc.readdUntil.get(player.id);
  const mode = acquisitionMode({
    settings: ctx.settings,
    phase: ctx.league.phase,
    blockedReason: fc.teamBlock ?? (fc.auctionPool.has(player.id) ? AUCTION_POOL_REASON : null) ?? (readd ? readdReason(readd, ctx.settings.general.timezone) : null),
    waiverClearsAt: clears,
    gameStarted: gameLocked,
    now: fc.now,
    nextRun: fc.nextRun,
  });
  // "W" badge: recently dropped players always; game-locked free agents while adding them means a claim
  const onWaivers = (!!clears && clears > fc.now) || (gameLocked && mode.kind === "claim");
  return { spot: null, isMine: false, onWaivers, gameLocked, mode, processAt: mode.kind === "claim" ? mode.processAt : null };
}

/** Row action for the current manager */
export function rowAction(ctx: LeagueContext, fc: FantasyContext, a: Availability): "add" | "claim" | "blocked" | "drop" | "trade" | null {
  if (!ctx.myTeam) return null;
  if (a.spot) return a.isMine ? "drop" : tradeBlockFor(fc, a.spot.teamId) === null ? "trade" : null;
  return a.mode?.kind ?? null;
}
