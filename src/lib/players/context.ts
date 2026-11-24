// League-level fantasy state needed to render any player row: ownership, waivers, game locks, my claims,
// my watch list. Loaded once per request with a handful of batched queries.
import "server-only";
import type { NflGame, RosterSpot, Team, WaiverClaim } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueContext } from "@/lib/league";
import { weekGamesByTeam } from "@/lib/lineup";
import { lastWaiverRun, nextWaiverRun } from "@/lib/waiver-schedule";
import { acquisitionMode, isGameLocked, type AcquisitionMode } from "@/lib/players/logic";

export type SpotWithTeam = RosterSpot & { team: Team };

export interface FantasyContext {
  now: Date;
  spots: Map<string, SpotWithTeam>;
  waiverUntil: Map<string, Date>;
  myClaims: Map<string, WaiverClaim>;
  watch: Set<string>;
  games: Map<string, NflGame>;
  lastRun: Date | null;
  /** memoized nextWaiverRun (the result only depends on the hour of `from`) */
  nextRun: (from: Date) => Date | null;
  teams: Team[];
}

export async function loadFantasyContext(ctx: LeagueContext): Promise<FantasyContext> {
  const now = new Date();
  const [spots, states, claims, watch, games, teams] = await Promise.all([
    db.rosterSpot.findMany({ where: { leagueId: ctx.league.id }, include: { team: true } }),
    db.leaguePlayerState.findMany({ where: { leagueId: ctx.league.id, waiverClearsAt: { gt: now } }, select: { playerId: true, waiverClearsAt: true } }),
    ctx.myTeam ? db.waiverClaim.findMany({ where: { teamId: ctx.myTeam.id, status: "PENDING" } }) : Promise.resolve([] as WaiverClaim[]),
    db.watchlistEntry.findMany({ where: { userId: ctx.user.id, leagueId: ctx.league.id }, select: { playerId: true } }),
    weekGamesByTeam(ctx.season, ctx.week),
    db.team.findMany({ where: { leagueId: ctx.league.id }, orderBy: { name: "asc" } }),
  ]);
  return {
    now,
    spots: new Map(spots.map((s) => [s.playerId, s])),
    waiverUntil: new Map(states.map((s) => [s.playerId, s.waiverClearsAt!])),
    myClaims: new Map(claims.map((c) => [c.addPlayerId, c])),
    watch: new Set(watch.map((w) => w.playerId)),
    games,
    lastRun: lastWaiverRun(ctx.settings, now),
    nextRun: memoNextRun(ctx),
    teams,
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
  const game = player.team ? fc.games.get(player.team) : undefined;
  const gameLocked = isGameLocked(game, ctx.settings, fc.now, fc.lastRun);
  const mode = acquisitionMode({
    settings: ctx.settings,
    phase: ctx.league.phase,
    waiverClearsAt: clears,
    gameStarted: gameLocked,
    now: fc.now,
    nextRun: fc.nextRun,
  });
  const onWaivers = (!!clears && clears > fc.now) || gameLocked;
  return { spot: null, isMine: false, onWaivers: onWaivers && mode.kind !== "add", gameLocked, mode, processAt: mode.kind === "claim" ? mode.processAt : null };
}
