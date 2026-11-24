// Daily Monte Carlo playoff odds: builds simulation inputs from the database, runs the pure engine
// (./core.ts), applies deterministic clinch/elimination math and stores a PlayoffOddsSnapshot.
import type { League, Matchup } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveSettings, type LeagueSettings } from "@/lib/settings/schema";
import { getNflState } from "@/lib/nfl/state";
import { leagueWeekFor } from "@/lib/league-week";
import { leagueSeeds, divisionWinnersGetIn } from "@/lib/playoffs/seeding";
import { publish, topics } from "@/lib/realtime/bus";
import { advKey, playoffSchedule, type PlayoffSchedule } from "@/lib/playoffs/structure";
import { advancePlayoffs, bracketGames, loadStoredBracket, type StoredBracket } from "@/lib/playoffs/bracket";
import { COMMON_SHOCK_SD, defaultTau, simulatePlayoffOdds, type SimInput, type TeamOdds } from "./core";
import { clinchStatus, finalClinchStatus, markerFor, type ClinchStatus, type Marker } from "./clinch";
import { regressedPpg, simDataFrom, slotBasedSd, teamWeeklyProjections, type LeagueSimData } from "./inputs";
import { hashString } from "./rng";

export const DEFAULT_SIMULATIONS = 10_000;

/** One team's entry in PlayoffOddsSnapshot.data (probabilities are fractions 0..1). */
export interface SnapshotTeamOdds extends TeamOdds {
  marker: Marker | null;
  clinch: ClinchStatus;
  /** record and points at the time of the snapshot */
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /** seed if the season ended at snapshot time (null = out) */
  currentSeed: number | null;
  /** weekly mean used for the next week */
  weeklyMean: number;
  /** regular-season results included (last week with every game final) */
  throughWeek: number;
}

export interface OddsComputation {
  snapshotId: string | null;
  season: number;
  week: number;
  simulations: number;
  computedAt: Date;
  elapsedMs: number;
  mode: "REGULAR" | "PLAYOFFS";
  odds: SnapshotTeamOdds[];
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const r2 = (x: number) => Math.round(x * 100) / 100;

function localDay(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function parseSnapshotOdds(data: unknown): SnapshotTeamOdds[] {
  return Array.isArray(data) ? (data as SnapshotTeamOdds[]) : [];
}

/** Results-through week of a stored snapshot (older rows without it fall back to null). */
export function snapshotThroughWeek(data: unknown): number | null {
  const first = parseSnapshotOdds(data)[0];
  return typeof first?.throughWeek === "number" ? first.throughWeek : null;
}

interface WeeklyModel {
  mean: Record<string, Record<number, number>>;
  sd: Record<string, Record<number, number>>;
  remaining: Record<string, Record<number, number>>;
  defaultMean: number;
  defaultSd: number;
  nextMean: Record<string, number>;
}

/** Per-team weekly means/SDs: projections where available, regressed PPG otherwise, live matchup overrides. */
async function buildWeeklyModel(
  league: Pick<League, "id" | "season">,
  settings: LeagueSettings,
  data: LeagueSimData,
  weeks: number[],
  currentWeek: number,
  liveRows: Matchup[],
  opts: { useProjections: boolean },
): Promise<WeeklyModel> {
  const slotSd = slotBasedSd(settings);
  const totalPF = data.standings.reduce((a, r) => a + r.pointsFor, 0);
  const totalGames = [...data.gamesPlayed.values()].reduce((a, g) => a + g, 0);
  const proj = opts.useProjections ? await teamWeeklyProjections(league.id, league.season, weeks, settings, { currentWeek }) : new Map();
  const projMeans: number[] = [];
  for (const m of proj.values()) for (const p of m.values()) if (p.starters > 0) projMeans.push(p.mean);
  const leagueAvg = totalGames ? totalPF / totalGames : projMeans.length ? projMeans.reduce((a, b) => a + b, 0) / projMeans.length : 100;
  const minStarters = Math.max(1, Math.ceil(settings.roster.slots.reduce((a, s) => a + s.count, 0) / 2));
  const mean: WeeklyModel["mean"] = {};
  const sd: WeeklyModel["sd"] = {};
  const remaining: WeeklyModel["remaining"] = {};
  const nextMean: Record<string, number> = {};
  const pfBy = new Map(data.standings.map((r) => [r.team.id, r.pointsFor]));
  for (const t of data.teams) {
    const ppg = regressedPpg(pfBy.get(t.id) ?? 0, data.gamesPlayed.get(t.id) ?? 0, leagueAvg);
    mean[t.id] = {};
    sd[t.id] = {};
    remaining[t.id] = {};
    for (const w of weeks) {
      const p = proj.get(t.id)?.get(w);
      if (p && p.starters >= minStarters) {
        mean[t.id]![w] = p.mean;
        sd[t.id]![w] = Math.max(p.sd, slotSd * 0.6);
      } else {
        mean[t.id]![w] = r2(ppg);
        sd[t.id]![w] = slotSd;
      }
    }
    nextMean[t.id] = mean[t.id]![weeks[0] ?? 0] ?? r2(ppg);
  }
  // live / scored matchups override the projection for that week
  for (const m of liveRows) {
    for (const side of ["home", "away"] as const) {
      const id = side === "home" ? m.homeTeamId : m.awayTeamId;
      if (!id || !mean[id]) continue;
      const score = side === "home" ? m.homeScore : m.awayScore;
      const projected = side === "home" ? m.homeProjected : m.awayProjected;
      if (m.status === "FINAL") {
        mean[id]![m.week] = score;
        remaining[id]![m.week] = 0;
      } else if (m.status === "LIVE" || (m.week === currentWeek && projected > 0)) {
        const pre = mean[id]![m.week] ?? projected;
        if (projected > 0) mean[id]![m.week] = projected;
        remaining[id]![m.week] = m.status === "LIVE" ? Math.max(0, Math.min(1, (projected - score) / Math.max(1, pre))) : 1;
      }
      if (m.week === weeks[0]) nextMean[id] = mean[id]![m.week]!;
    }
  }
  return { mean, sd, remaining, defaultMean: leagueAvg, defaultSd: slotSd, nextMean };
}

/** Clinch / elimination status from the current standings and remaining schedule. */
export function clinchFor(data: LeagueSimData, settings: LeagueSettings, byes: number): Map<string, ClinchStatus> {
  if (!data.remaining.length) {
    const seeds = leagueSeeds(data.standings, settings).map((r) => r.team.id);
    const divWinners = data.standings.filter((r) => r.divisionRank === 1 && r.team.division).map((r) => r.team.id);
    return finalClinchStatus(data.teams.map((t) => t.id), seeds, divWinners, byes);
  }
  const remainingWeeks = new Set(data.remaining.map((m) => m.week)).size;
  const left = new Map<string, number>();
  for (const m of data.remaining) {
    if (m.homeTeamId) left.set(m.homeTeamId, (left.get(m.homeTeamId) ?? 0) + 1);
    if (m.awayTeamId) left.set(m.awayTeamId, (left.get(m.awayTeamId) ?? 0) + 1);
  }
  const median = settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN";
  return clinchStatus(
    data.standings.map((r) => ({
      id: r.team.id,
      division: r.team.division,
      wins: r.wins,
      losses: r.losses,
      ties: r.ties,
      remaining: (left.get(r.team.id) ?? 0) + (median ? remainingWeeks : 0),
      bonusWeeks: settings.niche.weeklyHighScoreBonusWin ? remainingWeeks : 0,
    })),
    { playoffTeams: settings.playoffs.teams, byes, wildcardsByPoints: settings.playoffs.wildcardsByPoints, seeding: settings.playoffs.seeding, divisionWinnersTopSeeds: settings.standings.divisionWinnersTopSeeds, divisionWinnersQualify: divisionWinnersGetIn(settings) && !settings.standings.divisionWinnersTopSeeds },
  );
}

function finishOdds(raw: TeamOdds[], data: LeagueSimData, settings: LeagueSettings, clinch: Map<string, ClinchStatus>, nextMean: Record<string, number>, bracket: StoredBracket | null): SnapshotTeamOdds[] {
  const by = new Map(data.standings.map((r) => [r.team.id, r]));
  const seeds = bracket ? bracket.winners.map((e) => e.teamId) : leagueSeeds(data.standings, settings).map((r) => r.team.id);
  return raw.map((o) => {
    const st = clinch.get(o.teamId) ?? { playoffs: null, division: null, bye: null };
    const row = by.get(o.teamId);
    const out: SnapshotTeamOdds = {
      ...o,
      playoffPct: st.playoffs === "clinched" ? 1 : st.playoffs === "eliminated" ? 0 : r4(o.playoffPct),
      byePct: st.bye === "clinched" ? 1 : st.bye === "eliminated" || st.playoffs === "eliminated" ? 0 : r4(o.byePct),
      divisionPct: st.division === "clinched" ? 1 : st.division === "eliminated" ? 0 : r4(o.divisionPct),
      finalsPct: st.playoffs === "eliminated" ? 0 : r4(o.finalsPct),
      champPct: st.playoffs === "eliminated" ? 0 : r4(o.champPct),
      seedDist: st.playoffs === "eliminated" ? o.seedDist.map(() => 0) : o.seedDist.map(r4),
      avgSeed: st.playoffs === "eliminated" ? null : o.avgSeed === null ? null : r2(o.avgSeed),
      projWins: r2(o.projWins),
      projLosses: r2(o.projLosses),
      projTies: r2(o.projTies),
      projPF: r2(o.projPF),
      leverage: o.leverage === null ? null : r4(o.leverage),
      firstPct: r4(o.firstPct),
      lastPct: r4(o.lastPct),
      marker: markerFor(st),
      clinch: st,
      wins: row?.wins ?? 0,
      losses: row?.losses ?? 0,
      ties: row?.ties ?? 0,
      pointsFor: row?.pointsFor ?? 0,
      currentSeed: seeds.indexOf(o.teamId) >= 0 ? seeds.indexOf(o.teamId) + 1 : null,
      weeklyMean: r2(nextMean[o.teamId] ?? 0),
      throughWeek: data.lastFinalWeek,
    };
    return out;
  });
}

function rulesFor(settings: LeagueSettings, sched: PlayoffSchedule): SimInput["rules"] {
  return {
    playoffTeams: settings.playoffs.teams,
    seeding: settings.playoffs.seeding,
    wildcardsByPoints: settings.playoffs.wildcardsByPoints ?? 0,
    divisionWinnersTopSeeds: settings.standings.divisionWinnersTopSeeds,
    divisionWinnersQualify: !!settings.playoffs.divisionWinnersQualify,
    reseed: settings.playoffs.reseed,
    tiebreakers: settings.standings.tiebreakers,
    medianGame: settings.niche.medianGameEachWeek || settings.matchups.format === "H2H_PLUS_MEDIAN",
    highScoreBonus: settings.niche.weeklyHighScoreBonusWin,
    roundWeeks: sched.roundWeeks,
  };
}

/**
 * Simulate the rest of the season (and the bracket) for one league and store a snapshot.
 * Returns null when there is nothing to simulate (no schedule, or the season is over).
 */
export async function computePlayoffOdds(
  leagueId: string,
  opts: { simulations?: number; seed?: number; save?: boolean; backfill?: boolean; now?: Date } = {},
): Promise<OddsComputation | null> {
  const league = await db.league.findUnique({ where: { id: leagueId } });
  if (!league) return null;
  if (league.phase === "OFFSEASON" || league.phase === "KEEPER") return null;
  const settings = resolveSettings(league.settings);
  const now = opts.now ?? new Date();
  const nfl = await getNflState();
  const week = leagueWeekFor(league, settings, nfl);
  const [teams, regular, playoffRows] = await Promise.all([
    db.team.findMany({ where: { leagueId }, orderBy: { createdAt: "asc" } }),
    db.matchup.findMany({ where: { leagueId, season: league.season, isPlayoff: false }, orderBy: [{ week: "asc" }, { id: "asc" }] }),
    db.matchup.findMany({ where: { leagueId, season: league.season, isPlayoff: true }, orderBy: { week: "asc" } }),
  ]);
  if (!regular.length || teams.length < 2) return null;
  if (opts.backfill) await backfillPlayoffOddsHistory(league, settings, teams, regular);

  const data = simDataFrom(teams, regular, settings);
  const sched = playoffSchedule(settings, teams.length);
  const stored = playoffRows.length ? await loadStoredBracket(leagueId, league.season) : null;
  const bracketMode = !!stored && !data.remaining.length;
  const regWeeks = [...new Set(data.remaining.map((m) => m.week))].sort((a, b) => a - b);
  const weeks = [...regWeeks, ...sched.roundWeeks.flat()];
  const model = await buildWeeklyModel(league, settings, data, weeks, week, [...data.remaining, ...playoffRows], { useProjections: true });

  let bracket: SimInput["bracket"] = null;
  if (bracketMode && stored) {
    const games = bracketGames(playoffRows, stored, sched.plan.rounds).filter((g) => g.kind === "WINNERS");
    const advanced: Record<string, string> = {};
    for (const g of games) if (g.winnerTeamId) advanced[advKey(g.round, g.slot)] = g.winnerTeamId;
    bracket = { seeds: stored.winners.map((e) => e.teamId), advanced };
  }
  const simulations = Math.max(500, Math.min(50_000, opts.simulations ?? DEFAULT_SIMULATIONS));
  const seed = opts.seed ?? hashString(`${leagueId}:${league.season}:${week}:${localDay(now, settings.general.timezone)}`);
  const result = simulatePlayoffOdds({
    teams: data.simTeams,
    h2h: data.h2h,
    games: data.games,
    mean: model.mean,
    sd: model.sd,
    remaining: model.remaining,
    rules: rulesFor(settings, sched),
    simulations,
    seed,
    tau: defaultTau(week),
    commonShockSD: COMMON_SHOCK_SD,
    bracket,
    leverageWeek: regWeeks[0] ?? null,
    defaultMean: model.defaultMean,
    defaultSd: model.defaultSd,
  });
  const clinch = bracketMode && stored
    ? finalClinchStatus(teams.map((t) => t.id), stored.winners.map((e) => e.teamId), data.standings.filter((r) => r.divisionRank === 1 && r.team.division).map((r) => r.team.id), sched.plan.byes)
    : clinchFor(data, settings, sched.plan.byes);
  const odds = finishOdds(result.odds, data, settings, clinch, model.nextMean, bracketMode ? stored : null);

  let snapshotId: string | null = null;
  if (opts.save !== false) {
    const latest = await db.playoffOddsSnapshot.findFirst({ where: { leagueId, season: league.season }, orderBy: { computedAt: "desc" } });
    // one snapshot per day: refresh today's row unless new results came in since it was taken
    const sameDay =
      latest &&
      latest.week === week &&
      localDay(latest.computedAt, settings.general.timezone) === localDay(now, settings.general.timezone) &&
      snapshotThroughWeek(latest.data) === data.lastFinalWeek &&
      !playoffRows.some((m) => m.status === "FINAL" && m.updatedAt > latest.computedAt);
    const payload = { season: league.season, week, simulations, data: odds as never, computedAt: now };
    const snap = sameDay ? await db.playoffOddsSnapshot.update({ where: { id: latest.id }, data: payload }) : await db.playoffOddsSnapshot.create({ data: { leagueId, ...payload } });
    snapshotId = snap.id;
    publish(topics.league(leagueId), "playoffs.odds", { week, snapshotId });
  }
  return { snapshotId, season: league.season, week, simulations, computedAt: now, elapsedMs: result.elapsedMs, mode: bracketMode ? "PLAYOFFS" : "REGULAR", odds };
}

/**
 * First run of a season: reconstruct odds as they stood after each completed week (results through that
 * week + points-per-game at the time) so the trend chart starts with history. Runs once per season.
 */
async function backfillPlayoffOddsHistory(league: League, settings: LeagueSettings, teams: { id: string }[], regular: Matchup[]) {
  const existing = await db.playoffOddsSnapshot.count({ where: { leagueId: league.id, season: league.season } });
  if (existing > 0) return 0;
  const teamRows = await db.team.findMany({ where: { leagueId: league.id }, orderBy: { createdAt: "asc" } });
  const full = simDataFrom(teamRows, regular, settings);
  const sched = playoffSchedule(settings, teams.length);
  const games = await db.nflGame.findMany({ where: { season: league.season, seasonType: "REG" }, select: { week: true, startTime: true } });
  const weekEnd = new Map<number, Date>();
  for (const g of games) if (!weekEnd.has(g.week) || g.startTime > weekEnd.get(g.week)!) weekEnd.set(g.week, g.startTime);
  let n = 0;
  for (let w = 1; w < full.lastFinalWeek; w++) {
    const data = simDataFrom(teamRows, regular, settings, w);
    if (!data.remaining.length) break;
    const regWeeks = [...new Set(data.remaining.map((m) => m.week))].sort((a, b) => a - b);
    const weeks = [...regWeeks, ...sched.roundWeeks.flat()];
    const model = await buildWeeklyModel(league, settings, data, weeks, w + 1, [], { useProjections: false });
    const result = simulatePlayoffOdds({
      teams: data.simTeams,
      h2h: data.h2h,
      games: data.games,
      mean: model.mean,
      sd: model.sd,
      rules: rulesFor(settings, sched),
      simulations: DEFAULT_SIMULATIONS,
      seed: hashString(`${league.id}:${league.season}:history:${w}`),
      tau: defaultTau(w + 1) + 1,
      commonShockSD: COMMON_SHOCK_SD,
      leverageWeek: regWeeks[0] ?? null,
      defaultMean: model.defaultMean,
      defaultSd: model.defaultSd,
    });
    const odds = finishOdds(result.odds, data, settings, clinchFor(data, settings, sched.plan.byes), model.nextMean, null);
    const end = weekEnd.get(w);
    // shortly after the week's last game, and always before "now" so the live snapshot stays the latest
    const ceiling = Date.now() - (full.lastFinalWeek - w + 1) * 60_000;
    const computedAt = new Date(Math.min(end ? end.getTime() + 6 * 3600_000 : Date.now() - (full.lastFinalWeek - w) * 7 * 864e5, ceiling));
    await db.playoffOddsSnapshot.create({ data: { leagueId: league.id, season: league.season, week: w + 1, simulations: DEFAULT_SIMULATIONS, data: odds as never, computedAt } });
    n++;
  }
  return n;
}

/** Daily job: advance every league's bracket, then recompute its odds. */
export async function computeAllPlayoffOdds(): Promise<string> {
  const leagues = await db.league.findMany({ select: { id: true, slug: true } });
  const parts: string[] = [];
  for (const l of leagues) {
    try {
      const adv = await advancePlayoffs(l.id);
      const res = await computePlayoffOdds(l.id, { backfill: true });
      parts.push(`${l.slug}: ${adv}; ${res ? `odds week ${res.week} (${res.simulations.toLocaleString()} sims, ${res.elapsedMs} ms)` : "no odds (season not active)"}`);
    } catch (e) {
      parts.push(`${l.slug}: error ${(e as Error).message}`);
    }
  }
  return parts.join(" | ") || "no leagues";
}
