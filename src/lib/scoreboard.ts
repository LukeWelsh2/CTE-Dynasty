// Team weekly scores, live projections and win probability for matchups.
import type { Matchup, NflGame, Player } from "@prisma/client";
import { db } from "@/lib/db";
import type { BracketGame } from "@/lib/playoffs/bracket";
import { bracketPlan } from "@/lib/playoffs/structure";
import type { LeagueSettings } from "@/lib/settings/schema";
import { canStart, getLineup, optimalLineup, weekGamesByTeam, type SlotView } from "@/lib/lineup";
import { weekPoints, type PlayerWeekPoints } from "@/lib/points";
import { rosterLimitProblems } from "@/lib/roster";
import { decideWinner, planAutoSubs, playingStarters, playoffRowWinners, unbracketedPlayoffWinner, type SubCandidate } from "@/lib/scoreboard-rules";
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
  /** lineup.autoSubOutPlayers: the inactive starter this player replaced */
  autoSubFor?: Player | null;
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
  /** starters who played or still can (niche.minimumStartersOrForfeit) */
  playing: number;
  /** lineup.bestBall: starters were chosen automatically */
  bestBall: boolean;
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

export interface TeamScoreInput {
  teamId: string;
  /** the saved (or previewed) lineup, one entry per starting slot in expandSlots order */
  slots: Pick<SlotView, "slot" | "slotIndex" | "label" | "eligible" | "playerId">[];
  /** current roster (bench / best-ball / auto-sub pool) */
  roster: { playerId: string; status: string; player: Player }[];
  /** every player referenced by `slots` or `roster` */
  playersById: Map<string, Player>;
  pts: Map<string, PlayerWeekPoints>;
  games: Map<string, NflGame>;
  /** commissioner score adjustments for the week */
  adjustments: number;
  settings: LeagueSettings;
}

/**
 * Score one team's week from already-loaded data (no DB access). Shared by teamWeekScore and the live board so
 * every view applies the same rules: lineup.bestBall (optimal lineup from actual points), lineup.autoSubOutPlayers
 * (inactive starters replaced from the bench), lineup.emptySlotPenalty and commissioner adjustments.
 */
export function buildTeamWeekScore(input: TeamScoreInput): TeamWeekScore {
  const { teamId, slots: lineup, roster, playersById, pts, games, settings } = input;
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

  const startable = roster.filter((r) => canStart(r.status, settings));
  const slotPlayers: (string | null)[] = lineup.map((l) => l.playerId);
  if (settings.lineup.bestBall) {
    // best ball: the optimal lineup from actual points (or live projection for games not final)
    const value = new Map<string, number>();
    for (const r of startable) {
      const l = line("BN", 0, "BN", r.playerId);
      value.set(r.playerId, l.gameState === "post" || l.gameState === "bye" ? l.points : l.liveProjected);
    }
    const best = optimalLineup(startable.map((r) => r.player), value, settings);
    lineup.forEach((l, i) => {
      slotPlayers[i] = best.find((b) => b.slot === l.slot && b.slotIndex === l.slotIndex)?.playerId ?? null;
    });
  }
  let starters = lineup.map((l, i) => line(l.slot, l.slotIndex, l.label, slotPlayers[i]));

  const candidate = (l: StarterLine): SubCandidate | null => {
    if (!l.player) return null;
    const st = l.pts?.stats ?? null;
    const gp = st?.gp;
    const hasStats = !!st && (gp !== undefined ? gp > 0 : Object.values(st).some((v) => v !== 0));
    return {
      playerId: l.player.id,
      position: l.player.position,
      injuryStatus: l.player.injuryStatus,
      gameState: l.gameState,
      kickoff: l.game?.startTime ?? null,
      hasStats,
      value: l.gameState === "post" ? l.points : l.liveProjected,
    };
  };
  if (settings.lineup.autoSubOutPlayers && !settings.lineup.bestBall) {
    const inLineup = new Set(slotPlayers.filter((x): x is string => !!x));
    const benchLines = startable.filter((r) => !inLineup.has(r.playerId)).map((r) => line("BN", 0, "BN", r.playerId));
    const subs = planAutoSubs(
      starters.map((st, i) => ({ eligible: lineup[i].eligible, player: candidate(st) })),
      benchLines.map(candidate).filter((c): c is SubCandidate => !!c),
      settings,
    );
    if (subs.size) {
      starters = starters.map((st, i) => {
        const sub = subs.get(i);
        if (!sub) return st;
        slotPlayers[i] = sub;
        return { ...line(st.slot, st.slotIndex, st.label, sub), autoSubFor: st.player };
      });
    }
  }
  const starterSet = new Set(slotPlayers.filter((x): x is string => !!x));
  const bench = roster
    .filter((r) => !starterSet.has(r.playerId))
    .map((r) => line(r.status === "ACTIVE" ? "BN" : r.status, 0, r.status === "ACTIVE" ? "BN" : r.status, r.playerId))
    .sort((a, b) => b.points - a.points || b.projected - a.projected);

  const adjustments = input.adjustments;
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
    playing: playingStarters(starters.map(candidate)),
    bestBall: !!settings.lineup.bestBall,
  };
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
  const adj = await db.scoreAdjustment.aggregate({ where: { teamId, season, week }, _sum: { points: true } });
  return buildTeamWeekScore({ teamId, slots: lineup, roster, playersById, pts, games, adjustments: adj._sum.points ?? 0, settings });
}

/** Probability that A beats B given live projections + remaining variance */
export function winProbability(a: Pick<TeamWeekScore, "liveProjected" | "variance">, b: Pick<TeamWeekScore, "liveProjected" | "variance">): number {
  const diff = a.liveProjected - b.liveProjected;
  const sd = Math.sqrt(a.variance + b.variance);
  if (sd < 0.01) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return normCdf(diff / sd);
}

/** Copy of a team score with every point zeroed (roster.illegalRosterPolicy = ZERO_POINTS). */
function zeroed(t: TeamWeekScore): TeamWeekScore {
  return { ...t, points: 0, projected: 0, liveProjected: 0, variance: 0 };
}

/**
 * roster.illegalRosterPolicy = ZERO_POINTS: teams whose roster broke a roster / position limit while the week
 * was being played. Decided while the week is open and remembered (KeyValue) so recalculating a final week later
 * doesn't depend on today's roster.
 */
async function zeroPointTeams(leagueId: string, season: number, week: number, settings: LeagueSettings, teamIds: string[], open: boolean): Promise<Set<string>> {
  const key = `scoreboard:illegal:${leagueId}:${season}:${week}`;
  const kv = await db.keyValue.findUnique({ where: { key } });
  const stored = new Set(Array.isArray(kv?.value) ? (kv!.value as string[]) : []);
  if (!open || settings.roster.illegalRosterPolicy !== "ZERO_POINTS") return settings.roster.illegalRosterPolicy === "ZERO_POINTS" ? stored : new Set();
  const spots = await db.rosterSpot.findMany({ where: { leagueId, teamId: { in: teamIds } }, include: { player: true } });
  const next = new Set(stored);
  for (const id of teamIds) {
    if (rosterLimitProblems(spots.filter((s) => s.teamId === id), settings).length) next.add(id);
  }
  if (next.size !== stored.size) {
    await db.keyValue.upsert({ where: { key }, create: { key, value: [...next] }, update: { value: [...next] } });
  }
  return next;
}

/**
 * Results for the playoff rows of `week`, decided by the bracket's own code (@/lib/playoffs/bracket bracketGames +
 * resolveTies): the combined score over every week of the game, a tie settled by standings.playoffMatchupTiebreakers
 * with the matchup seeds, the bracket's bench / highest-starter totals and its coin flip. `fresh` holds this week's
 * rows with their just-computed scores, win probability and status. Covers every row (any week) of the games played
 * this week; rows outside the bracket (no bracket position) aren't included. `before` = the stored playoff rows.
 */
async function playoffRowResults(leagueId: string, season: number, week: number, settings: LeagueSettings, fresh: Matchup[]) {
  // loaded on demand: the bracket module imports this one (teamWeekScore for its tie stats)
  const { bracketGames, loadStoredBracket, resolveTies } = await import("@/lib/playoffs/bracket");
  const [stored, stale] = await Promise.all([loadStoredBracket(leagueId, season), db.matchup.findMany({ where: { leagueId, season, isPlayoff: true } })]);
  const byId = new Map(fresh.map((r) => [r.id, r]));
  const rows = stale.map((r) => byId.get(r.id) ?? r);
  const rounds = bracketPlan(stored?.winners.length ?? 0).rounds;
  // tie stats (bench / highest starter) are only loaded for the games this refresh can settle
  const ties = await resolveTies(bracketGames(rows, stored, rounds).filter((g: BracketGame) => g.weeks.includes(week)), leagueId, season, settings);
  return { results: playoffRowWinners(bracketGames(rows, stored, rounds, ties), { week }), before: new Map(stale.map((r) => [r.id, r])) };
}

/**
 * Recompute every matchup for a league week: scores, projections, win probability, status and winner.
 * Called by the live scoring poller and after lineup / scoring changes.
 * Every row: lineup.bestBall / autoSubOutPlayers / emptySlotPenalty (inside teamWeekScore) and
 * roster.illegalRosterPolicy = ZERO_POINTS.
 * Regular season rows: matchups.allowTies + tiebreaker, lineup.benchPointsTiebreaker, niche.reverseScoringWeek and
 * niche.minimumStartersOrForfeit (decideWinner).
 * Playoff rows: the bracket's result (playoffRowWinners) — score alone over the whole game, ties by
 * standings.playoffMatchupTiebreakers, always a winner once every week of the game is final. Finishing the last week
 * of a multi-week game also writes the winner onto its earlier weeks' rows.
 */
export async function refreshWeekMatchups(leagueId: string, season: number, week: number, settings: LeagueSettings) {
  const games = await weekGamesByTeam(season, week);
  const matchups = await db.matchup.findMany({ where: { leagueId, season, week } });
  const allGames = [...new Set(games.values())];
  const anyStarted = allGames.some((g) => g.state !== "pre");
  const allFinal = allGames.length > 0 && allGames.every((g) => g.state === "post");
  const status = allFinal ? "FINAL" : anyStarted ? "LIVE" : "UPCOMING";
  const reverse = settings.niche.reverseScoringWeek === week;
  const minStarters = settings.niche.minimumStartersOrForfeit ?? 0;
  const teamIds = matchups.flatMap((m) => [m.homeTeamId, m.awayTeamId]).filter((x): x is string => !!x);
  const zero =
    settings.roster.illegalRosterPolicy === "ZERO_POINTS" && anyStarted
      ? await zeroPointTeams(leagueId, season, week, settings, teamIds, matchups.some((m) => m.status !== "FINAL"))
      : new Set<string>();
  const scored: { m: Matchup; home: TeamWeekScore | null; away: TeamWeekScore | null; row: Matchup }[] = [];
  for (const m of matchups) {
    let home = m.homeTeamId ? await teamWeekScore(m.homeTeamId, leagueId, season, week, settings, { games }) : null;
    let away = m.awayTeamId ? await teamWeekScore(m.awayTeamId, leagueId, season, week, settings, { games }) : null;
    if (home && zero.has(home.teamId)) home = zeroed(home);
    if (away && zero.has(away.teamId)) away = zeroed(away);
    // reverse scoring and forfeits only decide regular season games
    const flip = reverse && !m.isPlayoff;
    let homeWinProb = home && away ? winProbability(home, away) : home ? 1 : 0;
    if (flip && home && away) homeWinProb = 1 - homeWinProb;
    let winnerTeamId: string | null = null;
    if (!m.isPlayoff && status === "FINAL" && home && away) {
      const side = (t: TeamWeekScore) => ({ teamId: t.teamId, points: t.points, ...sideStats(t), forfeit: minStarters > 0 && t.playing < minStarters });
      winnerTeamId = decideWinner(side(home), side(away), settings, { reverse });
      if (winnerTeamId) homeWinProb = winnerTeamId === home.teamId ? 1 : 0;
    }
    const row: Matchup = {
      ...m,
      homeScore: home?.points ?? 0,
      awayScore: away?.points ?? 0,
      homeProjected: home?.liveProjected ?? 0,
      awayProjected: away?.liveProjected ?? 0,
      homeWinProb,
      status,
      winnerTeamId,
    };
    scored.push({ m, home, away, row });
  }

  // playoff rows: the bracket decides (and a game's last week also settles its earlier weeks' rows)
  const playoff = scored.filter((s) => s.row.isPlayoff);
  if (playoff.length) {
    const { results, before } = await playoffRowResults(leagueId, season, week, settings, playoff.map((s) => s.row));
    for (const s of playoff) {
      const r = results.get(s.row.id);
      if (r) {
        s.row.winnerTeamId = r.winnerTeamId;
        s.row.homeWinProb = r.homeWinProb;
      } else if (status === "FINAL" && s.home && s.away) {
        // a playoff row outside the bracket: its own score, a tie settled by the playoff tiebreakers
        s.row.winnerTeamId = unbracketedPlayoffWinner(s.row, sideStats(s.home), sideStats(s.away), settings, `${leagueId}:${season}:row:${s.row.id}`);
        if (s.row.winnerTeamId) s.row.homeWinProb = s.row.winnerTeamId === s.row.homeTeamId ? 1 : 0;
      }
    }
    const thisWeek = new Set(playoff.map((s) => s.row.id));
    for (const [id, r] of results) {
      const prev = before.get(id);
      if (!prev || thisWeek.has(id)) continue;
      if (prev.winnerTeamId !== r.winnerTeamId || prev.homeWinProb !== r.homeWinProb) await db.matchup.update({ where: { id }, data: { winnerTeamId: r.winnerTeamId, homeWinProb: r.homeWinProb } });
    }
  }

  const results = [];
  for (const { m, home, away, row } of scored) {
    const updated = await db.matchup.update({
      where: { id: m.id },
      data: {
        homeScore: row.homeScore,
        awayScore: row.awayScore,
        homeProjected: row.homeProjected,
        awayProjected: row.awayProjected,
        homeWinProb: row.homeWinProb,
        status: row.status,
        winnerTeamId: row.winnerTeamId,
      },
    });
    results.push({ matchup: updated, home, away });
  }
  return results;
}

/** Tiebreak stats of one side: bench points and the best single starter. */
function sideStats(t: TeamWeekScore): { benchPoints: number; topStarter: number } {
  return { benchPoints: t.benchPoints, topStarter: Math.max(0, ...t.starters.map((s) => s.points)) };
}
