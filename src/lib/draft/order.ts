// Rookie draft order from the previous season's results (reverse standings / PF / potential points / lottery),
// with playoff teams ordered by finish. Also the saved draft lottery.
import type { Team } from "@prisma/client";
import { db } from "@/lib/db";
import type { LeagueSettings } from "@/lib/settings/schema";
import { computeStandings, playoffSeeds, type StandingRow } from "@/lib/standings";
import { optimalLineup } from "@/lib/lineup";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { composeRookieOrder, type OrderSlot, type OrderTeamInput } from "@/lib/draft/logic";

export interface LotteryRecord {
  season: number;
  drawnAt: string;
  drawnById: string | null;
  /** lottery teams, worst first (pre-lottery seeds) */
  pool: string[];
  /** normalized odds (fractions) per pool team */
  odds: number[];
  /** drawn order, pick 1 first */
  result: string[];
  seed: number;
  official: boolean;
}

export const lotteryKey = (leagueId: string, season: number) => `draft-lottery:${leagueId}:${season}`;

export async function getLottery(leagueId: string, season: number): Promise<LotteryRecord | null> {
  const row = await db.keyValue.findUnique({ where: { key: lotteryKey(leagueId, season) } });
  return row ? (row.value as unknown as LotteryRecord) : null;
}

export interface RookieOrderRow extends OrderSlot {
  team: Team;
  wins: number;
  losses: number;
  ties: number;
  rank: number;
  pointsFor: number;
  potentialPoints: number;
  madePlayoffs: boolean;
  playoffFinish: number | null;
}

export interface RookieOrderResult {
  draftSeason: number;
  basisSeason: number;
  method: LeagueSettings["draft"]["rookie"]["orderMethod"];
  style: LeagueSettings["draft"]["rookie"]["style"];
  /** FINAL: basis season complete · PROJECTED: in progress · NO_RESULTS: nothing to base an order on */
  status: "FINAL" | "PROJECTED" | "NO_RESULTS";
  regularSeasonComplete: boolean;
  rows: RookieOrderRow[];
  lottery: LotteryRecord | null;
  /** current lottery pool (worst first) when the method is LOTTERY */
  lotteryPool: string[];
}

/** Potential points: each FINAL regular-season week's optimal lineup from the players the team had that week. */
export async function potentialPointsBySeason(leagueId: string, season: number, settings: LeagueSettings, weeks: number[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!weeks.length) return out;
  const [slots, spots, games] = await Promise.all([
    db.lineupSlot.findMany({ where: { leagueId, season, week: { in: weeks }, playerId: { not: null } }, select: { teamId: true, week: true, playerId: true } }),
    db.rosterSpot.findMany({ where: { leagueId }, select: { teamId: true, playerId: true, acquiredAt: true } }),
    db.nflGame.findMany({ where: { season, week: { in: weeks }, seasonType: "REG" }, select: { week: true, startTime: true } }),
  ]);
  const weekEnd = new Map<number, number>();
  for (const gm of games) weekEnd.set(gm.week, Math.max(weekEnd.get(gm.week) ?? 0, gm.startTime.getTime() + 6 * 3600_000));
  const playerIds = [...new Set([...slots.map((s) => s.playerId!), ...spots.map((s) => s.playerId)])];
  const [players, stats] = await Promise.all([
    db.player.findMany({ where: { id: { in: playerIds } }, select: { id: true, position: true } }),
    db.playerWeekStat.findMany({ where: { season, seasonType: "REG", week: { in: weeks }, playerId: { in: playerIds } }, select: { playerId: true, week: true, stats: true } }),
  ]);
  const posOf = new Map(players.map((p) => [p.id, p.position]));
  const pts = new Map<string, number>();
  for (const s of stats) pts.set(`${s.playerId}|${s.week}`, calcPoints(s.stats as StatMap, posOf.get(s.playerId) ?? "WR", settings.scoring).points);
  const teamIds = [...new Set([...slots.map((s) => s.teamId), ...spots.map((s) => s.teamId)])];
  for (const teamId of teamIds) {
    let total = 0;
    for (const w of weeks) {
      const end = weekEnd.get(w) ?? Infinity;
      const ids = new Set<string>();
      for (const s of slots) if (s.teamId === teamId && s.week === w) ids.add(s.playerId!);
      for (const s of spots) if (s.teamId === teamId && s.acquiredAt.getTime() <= end) ids.add(s.playerId);
      const roster = [...ids].map((id) => ({ id, position: posOf.get(id) ?? "WR" }));
      const value = new Map(roster.map((p) => [p.id, pts.get(`${p.id}|${w}`) ?? 0]));
      for (const a of optimalLineup(roster, value, settings)) if (a.playerId) total += value.get(a.playerId) ?? 0;
    }
    out.set(teamId, Math.round(total * 100) / 100);
  }
  return out;
}

interface PlayoffInfo {
  madePlayoffs: Set<string>;
  finish: Map<string, number>;
  final: boolean;
}

async function playoffInfo(leagueId: string, season: number, standings: StandingRow[], settings: LeagueSettings): Promise<PlayoffInfo> {
  const ms = await db.matchup.findMany({ where: { leagueId, season, isPlayoff: true, isConsolation: false } });
  if (!ms.length) {
    const seeds = playoffSeeds(standings, settings);
    return { madePlayoffs: new Set(seeds.map((s) => s.team.id)), finish: new Map(seeds.map((s, i) => [s.team.id, i + 1])), final: false };
  }
  const seedOf = new Map<string, number>();
  const deepest = new Map<string, number>();
  for (const m of ms) {
    for (const [id, seed] of [[m.homeTeamId, m.homeSeed], [m.awayTeamId, m.awaySeed]] as const) {
      if (!id) continue;
      if (seed) seedOf.set(id, seed);
      deepest.set(id, Math.max(deepest.get(id) ?? 0, m.bracketRound ?? 1));
    }
  }
  const champ = ms.find((m) => m.isChampionship);
  const champDone = champ?.status === "FINAL" && !!champ.winnerTeamId;
  const ids = [...deepest.keys()];
  ids.sort((a, b) => {
    if (champDone) {
      if (a === champ!.winnerTeamId) return -1;
      if (b === champ!.winnerTeamId) return 1;
    }
    return (deepest.get(b) ?? 0) - (deepest.get(a) ?? 0) || (seedOf.get(a) ?? 99) - (seedOf.get(b) ?? 99);
  });
  return { madePlayoffs: new Set(ids), finish: new Map(ids.map((id, i) => [id, i + 1])), final: champDone };
}

/** The computed rookie draft order for `draftSeason` (based on the season before it). */
export async function computeRookieOrder(leagueId: string, draftSeason: number, settings: LeagueSettings): Promise<RookieOrderResult> {
  const basisSeason = draftSeason - 1;
  const r = settings.draft.rookie;
  const [teams, teamSeasons, finalWeeks, lottery] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } }),
    db.teamSeason.findMany({ where: { leagueId, season: basisSeason } }),
    db.matchup.findMany({ where: { leagueId, season: basisSeason, isPlayoff: false, status: "FINAL" }, select: { week: true }, distinct: ["week"] }),
    getLottery(leagueId, draftSeason),
  ]);
  const weeks = finalWeeks.map((w) => w.week).sort((a, b) => a - b);
  const archived = teamSeasons.length > 0 && teams.every((t) => teamSeasons.some((ts) => ts.teamId === t.id));
  const regularSeasonComplete = archived || weeks.length >= settings.general.regularSeasonWeeks;

  if (!archived && !weeks.length) {
    const rows: RookieOrderRow[] = teams.map((t, i) => ({
      teamId: t.id, slot: i + 1, group: "ALL", basis: `No ${basisSeason} results`, team: t, wins: 0, losses: 0, ties: 0, rank: i + 1,
      pointsFor: 0, potentialPoints: 0, madePlayoffs: false, playoffFinish: null,
    }));
    return { draftSeason, basisSeason, method: r.orderMethod, style: r.style, status: "NO_RESULTS", regularSeasonComplete: false, rows, lottery, lotteryPool: [] };
  }

  const standings = await computeStandings(leagueId, basisSeason, settings);
  const potential = await potentialPointsBySeason(leagueId, basisSeason, settings, weeks);
  let info: PlayoffInfo;
  if (archived) {
    const made = new Set(teamSeasons.filter((t) => t.madePlayoffs).map((t) => t.teamId));
    info = { madePlayoffs: made, finish: new Map(teamSeasons.filter((t) => t.finalRank).map((t) => [t.teamId, t.finalRank!])), final: true };
  } else {
    info = await playoffInfo(leagueId, basisSeason, standings, settings);
  }
  const byTeam = new Map(standings.map((s) => [s.team.id, s]));
  const tsByTeam = new Map(teamSeasons.map((t) => [t.teamId, t]));
  const inputs: OrderTeamInput[] = teams.map((t) => {
    const s = byTeam.get(t.id);
    const ts = tsByTeam.get(t.id);
    return {
      teamId: t.id,
      rank: (archived ? ts?.regularSeasonRank : null) ?? s?.rank ?? teams.length,
      pointsFor: archived && ts ? ts.pointsFor : s?.pointsFor ?? 0,
      potentialPoints: potential.get(t.id) ?? 0,
      madePlayoffs: info.madePlayoffs.has(t.id),
      playoffFinish: info.madePlayoffs.has(t.id) ? info.finish.get(t.id) ?? null : null,
    };
  });
  const slots = composeRookieOrder({
    teams: inputs,
    method: r.orderMethod,
    playoffTeamsByFinish: r.playoffTeamsByFinish,
    lotteryTeams: r.lottery.teams,
    lotteryResult: lottery?.official ? lottery.result : null,
  });
  const inputBy = new Map(inputs.map((i) => [i.teamId, i]));
  if (!info.final) {
    // the bracket isn't decided: describe playoff teams by seed / projected finish instead of "Champion"
    const started = !archived && (await db.matchup.count({ where: { leagueId, season: basisSeason, isPlayoff: true, isConsolation: false } })) > 0;
    for (const s of slots) {
      if (s.group !== "PLAYOFF") continue;
      const f = inputBy.get(s.teamId)?.playoffFinish;
      s.basis = started ? `Playoffs in progress · projected ${f ? ordinalOf(f) : "—"}` : `Projected playoff seed #${f ?? "—"}`;
    }
  }
  const rows: RookieOrderRow[] = slots.map((slot) => {
    const i = inputBy.get(slot.teamId)!;
    const s = byTeam.get(slot.teamId);
    const ts = tsByTeam.get(slot.teamId);
    return {
      ...slot,
      team: teams.find((t) => t.id === slot.teamId)!,
      wins: archived && ts ? ts.wins : s?.wins ?? 0,
      losses: archived && ts ? ts.losses : s?.losses ?? 0,
      ties: archived && ts ? ts.ties : s?.ties ?? 0,
      rank: i.rank,
      pointsFor: i.pointsFor,
      potentialPoints: i.potentialPoints,
      madePlayoffs: i.madePlayoffs,
      playoffFinish: i.playoffFinish,
    };
  });
  // lottery pool = the worst N by reverse standings (non-playoff first when playoff teams go by finish)
  const poolOrder = composeRookieOrder({ teams: inputs, method: "LOTTERY", playoffTeamsByFinish: r.playoffTeamsByFinish, lotteryTeams: r.lottery.teams, lotteryResult: null });
  const lotteryPool = poolOrder.filter((s) => s.group === "LOTTERY").map((s) => s.teamId);
  const status = info.final && regularSeasonComplete ? "FINAL" : "PROJECTED";
  return { draftSeason, basisSeason, method: r.orderMethod, style: r.style, status, regularSeasonComplete, rows, lottery, lotteryPool };
}

function ordinalOf(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
