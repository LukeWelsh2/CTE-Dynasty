// Database → simulation inputs: standings, head-to-head, remaining schedule and per-team weekly
// score distributions (optimal-lineup projection from PlayerWeekProjection; season PPG fallback).
import type { League, Matchup, Team } from "@prisma/client";
import { db } from "@/lib/db";
import { expandSlots, type LeagueSettings } from "@/lib/settings/schema";
import { normalizePosition } from "@/lib/settings/stat-catalog";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import { optimalLineup } from "@/lib/lineup";
import { POSITION_SD } from "@/lib/scoreboard";
import { standingsFromMatchups, type StandingRow } from "@/lib/standings";
import type { SimGame, SimTeam } from "./core";

/** Players who won't play for the foreseeable future (excluded from every projected week). */
const LONG_TERM_OUT = new Set(["IR", "PUP", "Sus", "SUS", "NA", "COV", "NFI"]);
/** Out this week only. */
const OUT_THIS_WEEK = new Set(["Out", "O"]);

export interface TeamWeekProjection {
  mean: number;
  sd: number;
  /** filled starter slots with a projection */
  starters: number;
}

/** Weekly SD for a full lineup from the league's starter slots (used when no projections exist). */
export function slotBasedSd(settings: LeagueSettings): number {
  let v = 0;
  for (const s of expandSlots(settings)) {
    const sd = Math.max(...s.eligible.map((p) => POSITION_SD[normalizePosition(p)] ?? 6));
    v += sd * sd;
  }
  return Math.sqrt(v) || 24;
}

/**
 * Optimal-lineup projected points per team per week from current rosters (ACTIVE players).
 * Weeks without any projection data are omitted (callers fall back to season PPG).
 */
export async function teamWeeklyProjections(
  leagueId: string,
  season: number,
  weeks: number[],
  settings: LeagueSettings,
  opts: { currentWeek?: number } = {},
): Promise<Map<string, Map<number, TeamWeekProjection>>> {
  const out = new Map<string, Map<number, TeamWeekProjection>>();
  const uniq = [...new Set(weeks)].filter((w) => w >= 1 && w <= 18).sort((a, b) => a - b);
  if (!uniq.length) return out;
  const spots = await db.rosterSpot.findMany({
    where: { leagueId, status: "ACTIVE" },
    select: { teamId: true, player: { select: { id: true, position: true, injuryStatus: true } } },
  });
  const ids = spots.map((s) => s.player.id);
  const projs = ids.length
    ? await db.playerWeekProjection.findMany({
        where: { season, seasonType: "REG", week: { in: uniq }, playerId: { in: ids } },
        select: { playerId: true, week: true, stats: true },
      })
    : [];
  const pos = new Map(spots.map((s) => [s.player.id, s.player.position]));
  const injury = new Map(spots.map((s) => [s.player.id, s.player.injuryStatus ?? ""]));
  const value = new Map<number, Map<string, number>>();
  const weeksWithData = new Set<number>();
  for (const p of projs) {
    weeksWithData.add(p.week);
    if (!value.has(p.week)) value.set(p.week, new Map());
    const inj = injury.get(p.playerId) ?? "";
    if (LONG_TERM_OUT.has(inj)) continue;
    if (opts.currentWeek === p.week && OUT_THIS_WEEK.has(inj)) continue;
    let pts = calcPoints(p.stats as StatMap, pos.get(p.playerId) ?? "WR", settings.scoring).points;
    if (opts.currentWeek === p.week && inj === "Doubtful") pts *= 0.25;
    value.get(p.week)!.set(p.playerId, pts);
  }
  const byTeam = new Map<string, { id: string; position: string }[]>();
  for (const s of spots) {
    if (!byTeam.has(s.teamId)) byTeam.set(s.teamId, []);
    byTeam.get(s.teamId)!.push(s.player);
  }
  for (const [teamId, players] of byTeam) {
    const m = new Map<number, TeamWeekProjection>();
    for (const w of uniq) {
      if (!weeksWithData.has(w)) continue;
      const vals = value.get(w) ?? new Map<string, number>();
      const lineup = optimalLineup(players, vals, settings);
      let mean = 0;
      let variance = 0;
      let starters = 0;
      for (const a of lineup) {
        if (!a.playerId) continue;
        const v = vals.get(a.playerId) ?? 0;
        if (v <= 0) continue;
        mean += v;
        starters++;
        const sd = POSITION_SD[normalizePosition(pos.get(a.playerId))] ?? 6;
        variance += sd * sd;
      }
      m.set(w, { mean: Math.round(mean * 100) / 100, sd: Math.sqrt(variance), starters });
    }
    out.set(teamId, m);
  }
  return out;
}

export interface LeagueSimData {
  teams: Team[];
  regular: Matchup[];
  final: Matchup[];
  remaining: Matchup[];
  standings: StandingRow[];
  simTeams: SimTeam[];
  h2h: Record<string, { w: number; l: number }>;
  games: SimGame[];
  /** last regular-season week with every game FINAL (0 = none) */
  lastFinalWeek: number;
  /** head-to-head games played per team (excludes median games) */
  gamesPlayed: Map<string, number>;
}

/** Head-to-head wins/losses from final regular-season matchups (same result logic as the standings). */
export function headToHead(matchups: Matchup[]): Record<string, { w: number; l: number }> {
  const h2h: Record<string, { w: number; l: number }> = {};
  for (const m of matchups) {
    if (!m.homeTeamId || !m.awayTeamId) continue;
    let hr: "W" | "L" | "T";
    if (m.winnerTeamId === m.homeTeamId) hr = "W";
    else if (m.winnerTeamId === m.awayTeamId) hr = "L";
    else hr = m.homeScore > m.awayScore ? "W" : m.homeScore < m.awayScore ? "L" : "T";
    const k1 = `${m.homeTeamId}|${m.awayTeamId}`;
    const k2 = `${m.awayTeamId}|${m.homeTeamId}`;
    const e1 = (h2h[k1] ??= { w: 0, l: 0 });
    const e2 = (h2h[k2] ??= { w: 0, l: 0 });
    if (hr === "W") (e1.w++, e2.l++);
    else if (hr === "L") (e1.l++, e2.w++);
  }
  return h2h;
}

export function toSimTeams(standings: StandingRow[], teams: Team[]): SimTeam[] {
  const by = new Map(standings.map((r) => [r.team.id, r]));
  return teams.map((t) => {
    const r = by.get(t.id);
    return {
      id: t.id,
      division: t.division,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      ties: r?.ties ?? 0,
      pointsFor: r?.pointsFor ?? 0,
      pointsAgainst: r?.pointsAgainst ?? 0,
      divWins: r?.divWins ?? 0,
      divLosses: r?.divLosses ?? 0,
      divTies: r?.divTies ?? 0,
      allPlayWins: r?.allPlayWins ?? 0,
      allPlayLosses: r?.allPlayLosses ?? 0,
      allPlayTies: r?.allPlayTies ?? 0,
    };
  });
}

/** Regular-season state (pure). `throughWeek` rewinds to the end of that week (later results count as unplayed). */
export function simDataFrom(teams: Team[], regular: Matchup[], settings: LeagueSettings, throughWeek?: number): LeagueSimData {
  const isFinal = (m: Matchup) => m.status === "FINAL" && (throughWeek === undefined || m.week <= throughWeek);
  const final = regular.filter(isFinal);
  const remaining = regular.filter((m) => !isFinal(m));
  const standings = standingsFromMatchups(teams, final, settings);
  const weeks = [...new Set(regular.map((m) => m.week))].sort((a, b) => a - b);
  let lastFinalWeek = 0;
  for (const w of weeks) {
    if (regular.filter((m) => m.week === w).every(isFinal)) lastFinalWeek = w;
    else break;
  }
  const gamesPlayed = new Map<string, number>(teams.map((t) => [t.id, 0]));
  for (const m of final) {
    if (m.homeTeamId) gamesPlayed.set(m.homeTeamId, (gamesPlayed.get(m.homeTeamId) ?? 0) + 1);
    if (m.awayTeamId) gamesPlayed.set(m.awayTeamId, (gamesPlayed.get(m.awayTeamId) ?? 0) + 1);
  }
  return {
    teams,
    regular,
    final,
    remaining,
    standings,
    simTeams: toSimTeams(standings, teams),
    h2h: headToHead(final),
    games: remaining.filter((m) => m.homeTeamId && m.awayTeamId).map((m) => ({ week: m.week, home: m.homeTeamId!, away: m.awayTeamId! })),
    lastFinalWeek,
    gamesPlayed,
  };
}

export async function loadLeagueSimData(league: Pick<League, "id" | "season">, settings: LeagueSettings, opts: { throughWeek?: number } = {}): Promise<LeagueSimData> {
  const [teams, regular] = await Promise.all([
    db.team.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "asc" } }),
    db.matchup.findMany({ where: { leagueId: league.id, season: league.season, isPlayoff: false }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
  ]);
  return simDataFrom(teams, regular, settings, opts.throughWeek);
}

/** Points per game so far, regressed toward the league average early in the season. */
export function regressedPpg(pointsFor: number, games: number, leagueAvg: number, priorGames = 2): number {
  return (pointsFor + priorGames * leagueAvg) / Math.max(1, games + priorGames);
}
