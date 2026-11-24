// Team weekly scores, live projections and win probability for matchups.
import type { NflGame, Player } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { getLineup, weekGamesByTeam, type SlotView } from "@/lib/lineup";
import { weekPoints, type PlayerWeekPoints } from "@/lib/points";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { normCdf } from "@/lib/utils";

/** Weekly fantasy points standard deviation by position (used for win probability + sims) */
export const POSITION_SD: Record<string, number> = { QB: 7.5, RB: 7.8, WR: 7.6, TE: 5.8, K: 4.2, DEF: 5.6, DL: 3.5, LB: 4, DB: 3.5 };

export type GameState = "pre" | "in" | "post" | "bye";

export interface StarterLine {
  slot: string;
  slotIndex: number;
  label: string;
  player: Player | null;
  points: number;
  projected: number;
  /** live projected final = actual + remaining share of projection */
  liveProjected: number;
  gameState: GameState;
  game: NflGame | null;
  remainingFraction: number;
  pts: PlayerWeekPoints | null;
}

export interface TeamWeekScore {
  teamId: string;
  starters: StarterLine[];
  bench: StarterLine[];
  points: number;
  projected: number;
  liveProjected: number;
  variance: number;
  adjustments: number;
  yetToPlay: number;
  inProgress: number;
  benchPoints: number;
}

/** Fraction of a game still to be played (1 = not started, 0 = final) */
export function remainingFraction(game: NflGame | null | undefined): number {
  if (!game) return 0;
  if (game.state === "pre") return 1;
  if (game.state === "post") return 0;
  const period = game.period ?? 1;
  const [m, s] = (game.clock ?? "15:00").split(":").map(Number);
  const secLeftInPeriod = (m || 0) * 60 + (s || 0);
  const elapsed = Math.min(4, period - 1) * 900 + (900 - secLeftInPeriod);
  return Math.max(0, Math.min(1, 1 - elapsed / 3600));
}

function gameStateFor(team: string | null | undefined, games: Map<string, NflGame>): GameState {
  if (!team) return "bye";
  const g = games.get(team);
  if (!g) return "bye";
  return (g.state as GameState) ?? "pre";
}

export async function teamWeekScore(
  teamId: string,
  leagueId: string,
  season: number,
  week: number,
  settings: LeagueSettings,
  opts: { games?: Map<string, NflGame> } = {},
): Promise<TeamWeekScore> {
  const games = opts.games ?? (await weekGamesByTeam(season, week));
  const lineup: SlotView[] = await getLineup(teamId, leagueId, season, week, settings);
  const roster = await db.rosterSpot.findMany({ where: { teamId }, include: { player: true } });
  // Starters may include players no longer rostered (past weeks) — load them too
  const starterIds = lineup.map((l) => l.playerId).filter((x): x is string => !!x);
  const missing = starterIds.filter((id) => !roster.some((r) => r.playerId === id));
  const extra = missing.length ? await db.player.findMany({ where: { id: { in: missing } } }) : [];
  const playersById = new Map<string, Player>([...roster.map((r) => [r.playerId, r.player] as const), ...extra.map((p) => [p.id, p] as const)]);
  const pts = await weekPoints([...playersById.values()], season, week, settings);

  const line = (slot: string, slotIndex: number, label: string, pid: string | null): StarterLine => {
    const player = pid ? playersById.get(pid) ?? null : null;
    const game = player?.team ? games.get(player.team) ?? null : null;
    const p = pid ? pts.get(pid) ?? null : null;
    const rf = player ? remainingFraction(game) : 0;
    const points = p?.points ?? 0;
    const projected = p?.projected ?? 0;
    return {
      slot,
      slotIndex,
      label,
      player,
      points,
      projected,
      liveProjected: points + projected * rf,
      gameState: gameStateFor(player?.team, games),
      game,
      remainingFraction: rf,
      pts: p,
    };
  };

  const starters = lineup.map((l) => line(l.slot, l.slotIndex, l.label, l.playerId));
  const starterSet = new Set(starterIds);
  const bench = roster
    .filter((r) => !starterSet.has(r.playerId))
    .map((r) => line(r.status === "ACTIVE" ? "BN" : r.status, 0, r.status === "ACTIVE" ? "BN" : r.status, r.playerId))
    .sort((a, b) => b.points - a.points || b.projected - a.projected);

  const adj = await db.scoreAdjustment.aggregate({ where: { teamId, season, week }, _sum: { points: true } });
  const adjustments = adj._sum.points ?? 0;
  const empty = starters.filter((s) => !s.player).length;
  const penalty = empty * (settings.lineup.emptySlotPenalty ?? 0);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const points = round2(starters.reduce((a, s) => a + s.points, 0) + adjustments - penalty);
  const projected = round2(starters.reduce((a, s) => a + s.projected, 0) + adjustments - penalty);
  const liveProjected = round2(starters.reduce((a, s) => a + s.liveProjected, 0) + adjustments - penalty);
  const variance = starters.reduce((a, s) => {
    if (!s.player) return a;
    const sd = POSITION_SD[normalizePosition(s.player.position)] ?? 6;
    return a + sd * sd * s.remainingFraction;
  }, 0);
  return {
    teamId,
    starters,
    bench,
    points,
    projected,
    liveProjected,
    variance,
    adjustments,
    yetToPlay: starters.filter((s) => s.player && s.gameState === "pre").length,
    inProgress: starters.filter((s) => s.gameState === "in").length,
    benchPoints: round2(bench.filter((b) => b.slot === "BN").reduce((a, b) => a + b.points, 0)),
  };
}

/** Probability that A beats B given live projections + remaining variance */
export function winProbability(a: Pick<TeamWeekScore, "liveProjected" | "variance">, b: Pick<TeamWeekScore, "liveProjected" | "variance">): number {
  const diff = a.liveProjected - b.liveProjected;
  const sd = Math.sqrt(a.variance + b.variance);
  if (sd < 0.01) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return normCdf(diff / sd);
}

/**
 * Recompute every matchup for a league week: scores, projections, win probability and status.
 * Called by the live scoring poller and after lineup / scoring changes.
 */
export async function refreshWeekMatchups(leagueId: string, season: number, week: number, settings: LeagueSettings) {
  const games = await weekGamesByTeam(season, week);
  const matchups = await db.matchup.findMany({ where: { leagueId, season, week } });
  const allGames = [...new Set(games.values())];
  const anyStarted = allGames.some((g) => g.state !== "pre");
  const allFinal = allGames.length > 0 && allGames.every((g) => g.state === "post");
  const results = [];
  for (const m of matchups) {
    const home = m.homeTeamId ? await teamWeekScore(m.homeTeamId, leagueId, season, week, settings, { games }) : null;
    const away = m.awayTeamId ? await teamWeekScore(m.awayTeamId, leagueId, season, week, settings, { games }) : null;
    const homeWinProb = home && away ? winProbability(home, away) : home ? 1 : 0;
    const status = allFinal ? "FINAL" : anyStarted ? "LIVE" : "UPCOMING";
    let winnerTeamId: string | null = null;
    if (status === "FINAL" && home && away) {
      if (home.points > away.points) winnerTeamId = m.homeTeamId;
      else if (away.points > home.points) winnerTeamId = m.awayTeamId;
      else if (settings.matchups.tiebreaker === "BENCH_POINTS") winnerTeamId = home.benchPoints >= away.benchPoints ? m.homeTeamId : m.awayTeamId;
      else if (settings.matchups.tiebreaker === "HOME_TEAM") winnerTeamId = m.homeTeamId;
      else if (settings.matchups.tiebreaker === "HIGHEST_STARTER") {
        const hMax = Math.max(0, ...home.starters.map((s) => s.points));
        const aMax = Math.max(0, ...away.starters.map((s) => s.points));
        winnerTeamId = hMax >= aMax ? m.homeTeamId : m.awayTeamId;
      }
    }
    const updated = await db.matchup.update({
      where: { id: m.id },
      data: {
        homeScore: home?.points ?? 0,
        awayScore: away?.points ?? 0,
        homeProjected: home?.liveProjected ?? 0,
        awayProjected: away?.liveProjected ?? 0,
        homeWinProb,
        status,
        winnerTeamId,
      },
    });
    results.push({ matchup: updated, home, away });
  }
  return results;
}
