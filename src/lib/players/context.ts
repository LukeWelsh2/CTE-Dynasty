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
import { acquisitionMode, eliminatedTeamIds, freeAgentGameLocked, readdCooldownUntil, type AcquisitionMode } from "@/lib/players/logic";

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
  /** can trades be proposed right now (settings.trades + deadline) */
  tradesOpen: boolean;
  /** why trading is closed (deadline passed, playoffs, disabled), null when open */
  tradesClosedReason: string | null;
}

/** Previous fantasy week's NFL games (empty in week 1) */
export async function previousWeekGames(ctx: Pick<LeagueContext, "season" | "week">): Promise<Map<string, NflGame>> {
  return ctx.week > 1 ? weekGamesByTeam(ctx.season, ctx.week - 1) : new Map();
}

/**
 * Team-level add block: settings.waivers.eliminatedTeamsCanAdd = false stops teams knocked out of (or not in)
 * the championship bracket from adding players during the playoffs.
 */
export async function teamAddBlock(ctx: LeagueContext): Promise<string | null> {
  if (!ctx.myTeam || ctx.league.phase !== "PLAYOFFS" || ctx.settings.waivers.eliminatedTeamsCanAdd !== false) return null;
  const [games, teams] = await Promise.all([
    db.matchup.findMany({
      where: { leagueId: ctx.league.id, season: ctx.season, isPlayoff: true, isConsolation: false },
      select: { homeTeamId: true, awayTeamId: true, status: true, winnerTeamId: true, homeScore: true, awayScore: true },
    }),
    db.team.findMany({ where: { leagueId: ctx.league.id }, select: { id: true } }),
  ]);
  return eliminatedTeamIds(
    games,
    teams.map((t) => t.id),
  ).has(ctx.myTeam.id)
    ? "Teams eliminated from the playoffs can't add players."
    : null;
}

export function readdReason(until: Date, tz: string): string {
  return `You dropped him recently — you can re-add him after ${fmtDateTime(until, tz)}.`;
}

export async function loadFantasyContext(ctx: LeagueContext): Promise<FantasyContext> {
  const now = new Date();
  const cooldownHours = ctx.settings.waivers.dropCooldownHours ?? 0;
  const [spots, states, claims, watch, games, prevGames, teams, teamBlock] = await Promise.all([
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
    teamAddBlock(ctx),
  ]);
  const waiverUntil = new Map<string, Date>();
  const readdUntil = new Map<string, Date>();
  for (const s of states) {
    if (s.waiverClearsAt && s.waiverClearsAt > now) waiverUntil.set(s.playerId, s.waiverClearsAt);
    const until = readdCooldownUntil(ctx.settings, s, ctx.myTeam?.id, now);
    if (until) readdUntil.set(s.playerId, until);
  }
  const tw = tradeWindow(ctx.settings, ctx.league.phase, ctx.week);
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
    teamBlock,
    tradesOpen: tw.open,
    tradesClosedReason: tw.open ? null : tw.reason,
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
    blockedReason: fc.teamBlock ?? (readd ? readdReason(readd, ctx.settings.general.timezone) : null),
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
  if (a.spot) return a.isMine ? "drop" : fc.tradesOpen ? "trade" : null;
  return a.mode?.kind ?? null;
}
