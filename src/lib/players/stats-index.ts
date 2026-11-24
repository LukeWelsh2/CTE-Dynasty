// In-memory indexes of weekly stats / projections for every NFL player, plus league-scored fantasy points.
// The players table sorts thousands of players by fantasy points, so we load the season once and reuse it
// until the underlying rows change (cheap max(updatedAt) + count version check on every request).
import "server-only";
import { db } from "@/lib/db";
import { calcPoints, type StatMap } from "@/lib/scoring/engine";
import type { LeagueSettings } from "@/lib/settings/schema";
import { perGame, playedInGame, round, sumStats, type Timeframe } from "@/lib/players/logic";

export interface WeekLine {
  stats: StatMap;
  opponent: string | null;
  team: string | null;
  gameId: string | null;
}

export interface RawIndex {
  version: string;
  byPlayer: Map<string, Map<number, WeekLine>>;
}

export interface PointsLine {
  byWeek: Map<number, number>;
  total: number;
  games: number;
  playedWeeks: number[];
}

export interface LeaguePoints {
  actual: Map<string, PointsLine>;
  proj: Map<string, Map<number, number>>;
}

interface Store {
  actual: Map<number, RawIndex>;
  proj: Map<string, RawIndex>;
  positions?: { at: number; map: Map<string, string> };
  league: Map<string, { key: string; points: LeaguePoints }>;
  inflight: Map<string, Promise<unknown>>;
}

const g = globalThis as unknown as { __ctePlayerIndex?: Store };
const store: Store = (g.__ctePlayerIndex ??= { actual: new Map(), proj: new Map(), league: new Map(), inflight: new Map() });

async function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = store.inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => store.inflight.delete(key));
  store.inflight.set(key, p);
  return p;
}

const IGNORED_PROJ_KEYS = /^(gp|gs|gms_active|adp_|pos_adp_|pts_|rank_|pos_rank_)/;
export function meaningfulProjection(stats: StatMap): boolean {
  for (const [k, v] of Object.entries(stats)) if (!IGNORED_PROJ_KEYS.test(k) && Number(v)) return true;
  return false;
}

/** Actual weekly stats (regular season) for every player. */
export async function getActualIndex(season: number): Promise<RawIndex> {
  const agg = await db.playerWeekStat.aggregate({ where: { season, seasonType: "REG" }, _max: { updatedAt: true }, _count: { _all: true } });
  const version = `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
  const cached = store.actual.get(season);
  if (cached?.version === version) return cached;
  return once(`actual:${season}:${version}`, async () => {
    const rows = await db.playerWeekStat.findMany({
      where: { season, seasonType: "REG" },
      select: { playerId: true, week: true, stats: true, opponent: true, team: true, gameId: true },
    });
    const byPlayer = new Map<string, Map<number, WeekLine>>();
    for (const r of rows) {
      let m = byPlayer.get(r.playerId);
      if (!m) byPlayer.set(r.playerId, (m = new Map()));
      m.set(r.week, { stats: (r.stats ?? {}) as StatMap, opponent: r.opponent, team: r.team, gameId: r.gameId });
    }
    const idx = { version, byPlayer };
    store.actual.set(season, idx);
    return idx;
  });
}

/** Weekly projections from `fromWeek` on (empty projections dropped). */
export async function getProjectionIndex(season: number, fromWeek: number): Promise<RawIndex> {
  const agg = await db.playerWeekProjection.aggregate({
    where: { season, seasonType: "REG", week: { gte: fromWeek } },
    _max: { updatedAt: true },
    _count: { _all: true },
  });
  const version = `${agg._count._all}:${agg._max.updatedAt?.getTime() ?? 0}`;
  const key = `${season}:${fromWeek}`;
  const cached = store.proj.get(key);
  if (cached?.version === version) return cached;
  return once(`proj:${key}:${version}`, async () => {
    const rows = await db.playerWeekProjection.findMany({
      where: { season, seasonType: "REG", week: { gte: fromWeek } },
      select: { playerId: true, week: true, stats: true, opponent: true, team: true },
    });
    const byPlayer = new Map<string, Map<number, WeekLine>>();
    for (const r of rows) {
      const stats = (r.stats ?? {}) as StatMap;
      if (!meaningfulProjection(stats)) continue;
      let m = byPlayer.get(r.playerId);
      if (!m) byPlayer.set(r.playerId, (m = new Map()));
      m.set(r.week, { stats, opponent: r.opponent, team: r.team, gameId: null });
    }
    const idx = { version, byPlayer };
    // keep only the latest window per season
    for (const k of store.proj.keys()) if (k.startsWith(`${season}:`)) store.proj.delete(k);
    store.proj.set(key, idx);
    return idx;
  });
}

/** player id -> raw position for every player (cached 10 minutes) */
export async function positionMap(): Promise<Map<string, string>> {
  if (store.positions && Date.now() - store.positions.at < 10 * 60_000) return store.positions.map;
  return once("positions", async () => {
    const rows = await db.player.findMany({ select: { id: true, position: true } });
    const map = new Map(rows.map((r) => [r.id, r.position]));
    store.positions = { at: Date.now(), map };
    return map;
  });
}

export interface PlayerIndexes {
  actual: RawIndex;
  proj: RawIndex;
  points: LeaguePoints;
}

/** Stats + projections + league-scored points for every player. */
export async function getLeagueIndexes(leagueId: string, season: number, settings: LeagueSettings, projFrom: number): Promise<PlayerIndexes> {
  const [actual, proj, positions] = await Promise.all([getActualIndex(season), getProjectionIndex(season, projFrom), positionMap()]);
  const key = `${actual.version}|${proj.version}|${projFrom}|${JSON.stringify(settings.scoring)}`;
  const cached = store.league.get(leagueId);
  if (cached?.key === key) return { actual, proj, points: cached.points };
  const points = await once(`league:${leagueId}:${key}`, async () => {
    const scoring = settings.scoring;
    const actualPts = new Map<string, PointsLine>();
    for (const [pid, weeks] of actual.byPlayer) {
      const pos = positions.get(pid) ?? "WR";
      const line: PointsLine = { byWeek: new Map(), total: 0, games: 0, playedWeeks: [] };
      for (const [w, l] of weeks) {
        const pts = calcPoints(l.stats, pos, scoring).points;
        line.byWeek.set(w, pts);
        line.total += pts;
        if (playedInGame(l.stats, pts)) {
          line.games++;
          line.playedWeeks.push(w);
        }
      }
      line.total = round(line.total);
      line.playedWeeks.sort((a, b) => a - b);
      actualPts.set(pid, line);
    }
    const projPts = new Map<string, Map<number, number>>();
    for (const [pid, weeks] of proj.byPlayer) {
      const pos = positions.get(pid) ?? "WR";
      const m = new Map<number, number>();
      for (const [w, l] of weeks) m.set(w, calcPoints(l.stats, pos, scoring).points);
      projPts.set(pid, m);
    }
    const pts: LeaguePoints = { actual: actualPts, proj: projPts };
    store.league.set(leagueId, { key, points: pts });
    return pts;
  });
  return { actual, proj, points };
}

// ───────────────────────────── Timeframe evaluation ─────────────────────────────

export interface TimeframeWindow {
  tf: Timeframe;
  /** current fantasy week */
  week: number;
  /** specific week for tf=week */
  specificWeek: number;
  rosFrom: number;
  rosTo: number;
}

function actualWeeks(w: TimeframeWindow): number[] | "season" {
  if (w.tf === "season" || w.tf === "avg") return "season";
  if (w.tf === "last") return [Math.max(1, w.week - 1)];
  return [w.specificWeek];
}

/** Fantasy points for a timeframe (null = no data, e.g. no game that week) */
export function timeframePoints(idx: PlayerIndexes, playerId: string, w: TimeframeWindow): number | null {
  if (w.tf === "proj") return idx.points.proj.get(playerId)?.get(w.week) ?? null;
  if (w.tf === "ros") {
    const m = idx.points.proj.get(playerId);
    if (!m) return null;
    let t = 0;
    let any = false;
    for (let wk = w.rosFrom; wk <= w.rosTo; wk++) {
      const v = m.get(wk);
      if (v !== undefined) {
        t += v;
        any = true;
      }
    }
    return any ? round(t) : null;
  }
  const line = idx.points.actual.get(playerId);
  if (!line) return null;
  const weeks = actualWeeks(w);
  if (weeks === "season") {
    let t = 0;
    for (const [wk, v] of line.byWeek) if (wk <= w.week) t += v;
    t = round(t);
    if (w.tf === "avg") {
      const games = line.playedWeeks.filter((x) => x <= w.week).length;
      return games ? round(t / games) : null;
    }
    return t;
  }
  const v = line.byWeek.get(weeks[0]!);
  return v === undefined ? null : v;
}

/** Season average per game played (through the current week) */
export function seasonAverage(idx: PlayerIndexes, playerId: string, week: number): number | null {
  const line = idx.points.actual.get(playerId);
  if (!line) return null;
  const played = line.playedWeeks.filter((x) => x <= week);
  if (!played.length) return null;
  let t = 0;
  for (const wk of played) t += line.byWeek.get(wk) ?? 0;
  return round(t / played.length);
}

/** Raw stat line for a timeframe (totals, per-game averages, one week, or projections) */
export function timeframeStats(idx: PlayerIndexes, playerId: string, w: TimeframeWindow): StatMap | null {
  if (w.tf === "proj") return idx.proj.byPlayer.get(playerId)?.get(w.week)?.stats ?? null;
  if (w.tf === "ros") {
    const m = idx.proj.byPlayer.get(playerId);
    if (!m) return null;
    const lines: StatMap[] = [];
    for (let wk = w.rosFrom; wk <= w.rosTo; wk++) {
      const l = m.get(wk);
      if (l) lines.push(l.stats);
    }
    return lines.length ? sumStats(lines) : null;
  }
  const weeksMap = idx.actual.byPlayer.get(playerId);
  if (!weeksMap) return null;
  const weeks = actualWeeks(w);
  if (weeks === "season") {
    const lines = [...weeksMap.entries()].filter(([wk]) => wk <= w.week).map(([, l]) => l.stats);
    const totals = sumStats(lines);
    if (w.tf === "avg") {
      const games = (idx.points.actual.get(playerId)?.playedWeeks ?? []).filter((x) => x <= w.week).length;
      return games ? perGame(totals, games) : null;
    }
    return totals;
  }
  return weeksMap.get(weeks[0]!)?.stats ?? null;
}
